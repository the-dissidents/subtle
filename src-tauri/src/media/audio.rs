use std::collections::VecDeque;

use enum_dispatch::enum_dispatch;
use ffmpeg::{codec, error::EAGAIN, format, software::{self, resampling}, ChannelLayout, Rational};
use getset::{CopyGetters, Getters};
use log::{debug, warn};
use num_traits::ToPrimitive;

use crate::media::{aggregation_tree::AggregationTree, demux, frame, internal::{check, MediaError}, units};

#[derive(Getters, CopyGetters)]
pub struct Decoder {
    inner: codec::decoder::Audio,

    #[getset(get = "pub")]
    stream_info: demux::StreamInfo,

    /// will be inaccurate in case of VFR
    #[getset(get_copy = "pub")]
    sample_rate: u32,

    /// number of samples
    #[getset(get_copy = "pub")]
    estimated_length: usize,
}

impl Decoder {
    pub fn create(
        demuxer: &demux::Demuxer, index: Option<usize>
    ) -> Result<Decoder, MediaError> {
        let (stream_info, stream) = match index {
            Some(i) => demuxer.get_stream_from_index(i),
            None => demuxer.get_stream_from_kind(demux::StreamKind::Audio)
        }?;

        // create decoder
        let codecxt = check!(codec::Context::from_parameters(stream.parameters()))?;
        let mut codec = check!(codecxt.decoder().audio())?;
        check!(codec.set_parameters(stream.parameters()))?;
        codec.set_packet_time_base(stream.time_base());

        let timebase = codec.time_base();
        if timebase != Rational(1, codec.rate().try_into().unwrap()) {
            warn!("create_audio_base: time_base = {timebase} but rate = {}", codec.rate());
        }

        let estimated_length = 
            units::Timestamp::from_seconds(demuxer.duration(), timebase)
            .0.to_usize().unwrap();

        debug!(
            "create_audio_base: [{}] len={}, decoder_tb={}, stream_tb={}, format={}, layout=0x{:x}",
            stream_info.index(),
            estimated_length,
            timebase,
            stream.time_base(),
            codec.format().name(),
            codec.channel_layout().bits()
        );

        Ok(Decoder {
            stream_info,
            estimated_length,
            sample_rate: codec.rate(),
            inner: codec,
        })
    }

    pub fn flush(&mut self) {
        self.inner.flush();
        self.stream_info.byte_pos_can_update = true;
        self.stream_info.byte_pos = -1;
    }

    pub fn feed(&mut self, packet: &demux::Packet) -> Result<(), MediaError> {
        if self.stream_info.byte_pos_can_update {
            self.stream_info.byte_pos = packet.position();
        }
        match self.inner.send_packet(packet) {
            Ok(()) => Ok(()),
            Err(ffmpeg_next::Error::Other { errno: EAGAIN }) => {
                warn!("audio::Decoder::feed: some frames haven't been read; flushing and resending");
                self.flush();
                // resend packet
                self.feed(packet)
            },
            Err(ffmpeg_next::Error::InvalidData) => {
                warn!("audio::Decoder::feed: met invalid data; flushing");
                self.flush();
                Ok(())
            },
            send_packet_error => check!(send_packet_error),
        }
    }

    pub fn try_receive(&mut self) -> Result<Option<frame::Audio>, MediaError> {
        let mut decoded = frame::AudioData::empty();
        let mut byte_pos: isize = -1;
        match self.inner.receive_frame(&mut decoded) {
            Ok(()) => {
                byte_pos = self.stream_info.byte_pos;
                self.stream_info.byte_pos_can_update = true;
            },
            Err(ffmpeg_next::Error::Other { errno: EAGAIN }) => {
                return Ok(None);
            }
            receive_frame_error => check!(receive_frame_error)?,
        }

        let time = units::Timestamp(
            decoded
            .pts()
            .ok_or(MediaError::InternalError(
                "decoded frame has no pts".to_owned(),
            ))?
        ).to_seconds(self.stream_info.timebase());

        Ok(Some(frame::Audio {
            meta: frame::FrameMetadata {
                time, byte_pos,
                pkt_pos: decoded.packet().position,
            },
            decoded,
        }))
    }
}

#[enum_dispatch]
pub enum AudioSinkKind {
    Player,
    Sampler
}

#[enum_dispatch(AudioSinkKind)]
pub trait AudioSink {
    fn clear(&mut self);
    fn is_empty(&self) -> bool;
    fn process(&mut self, frame: frame::Audio) -> Result<(), MediaError>;
}

pub struct Player {
    resampler: resampling::Context,
    frames: VecDeque<frame::Audio>
}

impl AudioSink for Player {
    fn clear(&mut self) {
        self.frames.clear();
    }

    fn is_empty(&self) -> bool {
        self.frames.is_empty()
    }

    fn process(&mut self, mut frame: frame::Audio) -> Result<(), MediaError> {
        let mut processed = frame::AudioData::empty();
        check!(self.resampler.run(&frame.decoded, &mut processed))?;
        frame.decoded = processed;
        self.frames.push_back(frame);
        Ok(())
    }
}

impl Player {
    pub fn create(decoder: &Decoder) -> Result<Self, MediaError> {
        // Same target as original: F32 packed, MONO, keep source rate
        let resampler = check!(software::resampler(
            (
                decoder.inner.format(),
                decoder.inner.channel_layout(),
                decoder.sample_rate()
            ),
            (
                format::Sample::F32(format::sample::Type::Packed),
                ChannelLayout::MONO,
                decoder.sample_rate()
            )
        ))?;
        Ok(Self { 
            resampler,
            frames: VecDeque::new()
        })
    }

    pub fn get_delta(&mut self) -> VecDeque<frame::Audio> {
        std::mem::take(&mut self.frames)
    }
}

pub struct Sampler {
    resampler: resampling::Context,
    start_time: units::Seconds,
    sample_per_second: usize,
    intensities: AggregationTree<f32, fn(f32, f32) -> f32>,

    data: Option<SamplerDeltaData>,
}

#[derive(Clone, serde::Serialize, Debug, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
#[ts(rename = "AudioSamplerDeltaData")]
pub struct SamplerDeltaData {
    pub start_index: usize,
    pub start_time: units::Seconds,
    pub end_time: units::Seconds,
    pub intensity: Vec<f32>,
}

impl Sampler {
    pub fn create(decoder: &Decoder, sample_per_second: usize) -> Result<Self, MediaError> {
        let resampler = check!(software::resampler(
            (
                decoder.inner.format(),
                decoder.inner.channel_layout(),
                decoder.sample_rate()
            ),
            (
                format::Sample::F32(format::sample::Type::Packed),
                ChannelLayout::MONO,
                decoder.sample_rate()
            )
        ))?;

        // capacity: ceil(duration_seconds) * sps
        let capacity = decoder
            .estimated_length()
            .div_ceil(decoder.sample_rate() as usize)
            .saturating_mul(sample_per_second);

        let intensities = AggregationTree::new(capacity, f32::max as fn(f32, f32) -> f32, f32::NAN);

        let start_time = decoder.stream_info().start_time_seconds();

        debug!("audio::Sampler::create: capacity={capacity}, sps={sample_per_second}, start_time={start_time}");

        Ok(Self {
            resampler,
            start_time,
            sample_per_second,
            intensities,
            data: None,
        })
    }

    pub fn get_delta(&mut self) -> Option<SamplerDeltaData> {
        std::mem::take(&mut self.data)
    }
}

impl AudioSink for Sampler {
    fn clear(&mut self) {
        self.data = None;
    }

    fn is_empty(&self) -> bool {
        self.data.is_none()
    }

    fn process(&mut self, frame: frame::Audio) -> Result<(), MediaError> {
        let sample_per_second_f64 = self.sample_per_second.to_f64().unwrap();
        let start_index_signed = 
            (sample_per_second_f64 * (frame.meta.time.0 - self.start_time.0))
            .to_isize().unwrap();

        if start_index_signed < 0 {
            // ignore out-of-bound data
            return Ok(());
        }

        let start_index = start_index_signed.to_usize().unwrap();
        if start_index > self.intensities.length {
            // ignore out-of-bound data
            return Ok(());
        }

        // Lazily init delta container
        if self.data.is_none() {
            self.data = Some(SamplerDeltaData {
                start_index,
                start_time: frame.meta.time,
                end_time: frame.meta.time,
                intensity: Vec::new(),
            });
        }

        let sd = self.data.as_mut().unwrap();
        let mut processed = frame::AudioData::empty();
        check!(self.resampler.run(&frame.decoded, &mut processed))?;

        let data: &[f32] = processed.plane(0);
        let mut index = start_index;
        let mut sum = self.intensities.at(index);
        let rate: f64 = processed.rate().into();

        for (i, sample) in data.iter().enumerate() {
            let delta_time = i.to_f64().unwrap() / rate;
            let new_index = 
                (sample_per_second_f64 * 
                    (frame.meta.time.0 - self.start_time.0 + delta_time))
                .to_usize().unwrap();

            if new_index != index {
                self.intensities.set(&[sum], index);

                let expected_next = sd.start_index + sd.intensity.len();
                if expected_next > index {
                    if index >= sd.start_index {
                        sd.intensity[index - sd.start_index] = sum;
                    }
                } else {
                    if expected_next < index {
                        // warn!("audio::Sampler::process: {expected_next} < {index}; filling with 0s");
                    }
                    while sd.start_index + sd.intensity.len() < index {
                        sd.intensity.push(0.0);
                    }
                    sd.intensity.push(sum);
                    sd.end_time = units::Seconds(frame.meta.time.0 + delta_time);
                }
                index = new_index;
                if index >= self.intensities.length {
                    return Ok(());
                }
                sum = self.intensities.at(index);
            }

            sum = sum.max(sample.abs());
        }

        self.intensities.set(&[sum], index);
        Ok(())
    }
}