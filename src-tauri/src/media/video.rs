use std::collections::{BTreeMap, VecDeque};

use enum_dispatch::enum_dispatch;
use ffmpeg::{codec, decoder, error::EAGAIN, format, software::scaling, Rescale};
use getset::{CopyGetters, Getters};
use log::{debug, warn};

use crate::media::{accel, demux, disjoint_interval_set::DisjointIntervalSet, frame, internal::{MediaError, check}, units::{Seconds, Timestamp, Rational, DEFAULT_TIMEBASE}};

#[derive(Getters, CopyGetters)]
pub struct Decoder {
    inner: codec::decoder::Video,
    accelerator: Option<accel::HardwareDecoder>,

    #[getset(get = "pub")]
    stream_info: demux::StreamInfo,

    #[getset(get_copy = "pub")]
    sample_aspect_ratio: Rational,

    #[getset(get_copy = "pub")]
    original_size: (u32, u32),

    #[getset(get_copy = "pub")]
    is_vfr: bool,

    /// will be inaccurate in case of VFR
    #[getset(get_copy = "pub")]
    framerate: Rational,
}

impl Decoder {
    pub fn create(
        demuxer: &demux::Demuxer, index: Option<usize>, accel: bool
    ) -> Result<Decoder, MediaError> {
        let (stream_info, stream) = match index {
            Some(i) => demuxer.get_stream_from_index(i),
            None => demuxer.get_stream_from_kind(demux::StreamKind::Video)
        }?;
        let index = stream_info.index();

        let codec = decoder::find(stream.parameters().id()).ok_or(
            MediaError::InternalError(
                format!("codec not found: {:?}", stream.parameters().id()),
        ))?;

        // create decoder
        let mut decoder_ctx = codec::Context::new_with_codec(codec).decoder();
        let thread_count = num_cpus::get().min(16);

        decoder_ctx.set_threading(codec::threading::Config { 
            kind: codec::threading::Type::Frame, 
            count: thread_count
        });

        debug!(
            "video::Decoder::create: codec = {:?}, using {} threads (num_cpus={})", 
            decoder_ctx.codec().map(|x| x.id()),
            thread_count,
            num_cpus::get()
        );

        let accelerator_name = 
            if !accel { "" }
            else if cfg!(windows) { "d3d11va" }
            else if cfg!(target_os = "macos") { "videotoolbox" }
            else { "" };
        let accelerator = 
            if accel::HardwareDecoder::available_types()
                .iter().any(|x| x == accelerator_name)
            {
                match accel::HardwareDecoder::create(accelerator_name, &mut decoder_ctx) {
                    Ok(x) => {
                        debug!("video::Decoder::create: using accelerator: {}", x.name());
                        Some(x)
                    },
                    Err(e) => {
                        debug!("video::Decoder::create: error creating accelerator: {e}, falling back");
                        None
                    }
                }
            } else { None };
        
        check!(decoder_ctx.set_parameters(stream.parameters()))?; // avcodec_parameters_to_context
        let decoder = check!(decoder_ctx.video())?;            // avcodec_open2

        let sample_aspect_ratio = match decoder.aspect_ratio() {
            Rational(0, _) => Rational(1, 1),
            x => if f64::from(x) <= 0.0 { Rational(1, 1) } else { x  }
        };

        if sample_aspect_ratio != Rational(1, 1) {
            debug!("video::Decoder::create: [{index}] note: video has an SAR of {sample_aspect_ratio}");
        }

        let avg_framerate = stream.avg_frame_rate(); // avg_frame_rate
        let framerate = stream.rate();               // r_frame_rate
        let is_vfr = framerate != avg_framerate;
        if is_vfr {
            warn!("video::Decoder::create: [{index}] note: stream is VFR, avg={avg_framerate}, rate={framerate}");
        }

        debug!(
            "video::Decoder::create: [{}] {:?}; decoder_fr={:?}",
            stream_info.index(),
            decoder.format(), decoder.frame_rate()
        );

        Ok(Decoder {
            stream_info,
            framerate,
            is_vfr,
            original_size: (decoder.width(), decoder.height()),
            sample_aspect_ratio,
            inner: decoder, accelerator,
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
                warn!("video::Decoder::feed: some frames haven't been read! flushing.");
                self.flush();
                // resend packet
                self.feed(packet)
            },
            Err(ffmpeg_next::Error::InvalidData) => {
                warn!("video::Decoder::feed: met invalid data; flushing");
                self.flush();
                Ok(())
            },
            send_packet_error => check!(send_packet_error),
        }
    }

    pub fn try_receive(&mut self) -> Result<Option<frame::Video>, MediaError> {
        let mut decoded = frame::VideoData::empty();
        let mut byte_pos: isize = -1;
        match self.inner.receive_frame(&mut decoded) {
            Ok(()) => {
                byte_pos = self.stream_info.byte_pos;
                self.stream_info.byte_pos_can_update = true;
            }
            Err(ffmpeg_next::Error::Other { errno: EAGAIN }) => {
                // trace!("receive: EAGAIN");
                return Ok(None);
            }
            receive_frame_error => check!(receive_frame_error)?,
        }

        let time = Timestamp(
            decoded
            .pts()
            // fall back to packet's DTS if no pts available (as in AVI)
            .unwrap_or(decoded.packet().dts)
        ).to_seconds(self.stream_info.timebase());

        if self.accelerator.is_some() {
            let mut sw_frame = frame::VideoData::empty();
            check!(accel::HardwareDecoder::transfer_frame(&decoded, &mut sw_frame))?;
            decoded = sw_frame;
        }

        Ok(Some(frame::Video {
            meta: frame::FrameMetadata {
                time, byte_pos,
                pkt_pos: decoded.packet().position,
            },
            decoded,
        }))
    }
}

#[enum_dispatch]
pub enum VideoSinkKind {
    Player,
    Sampler
}

#[enum_dispatch(VideoSinkKind)]
pub trait VideoSink {
    fn clear(&mut self);
    fn is_empty(&self) -> bool;
    fn process(&mut self, frame: frame::Video) -> Result<(), MediaError>;
}

pub struct Player {
    original_format: format::Pixel,
    original_size: (u32, u32),
    output_size: (u32, u32),
    scaling_method: scaling::Flags,
    scaler: scaling::Context,

    frames: VecDeque<frame::Video>
}

impl VideoSink for Player {
    fn clear(&mut self) {
        self.frames.clear();
    }

    fn is_empty(&self) -> bool {
        self.frames.is_empty()
    }

    fn process(&mut self, mut frame: frame::Video) -> Result<(), MediaError> {
        if frame.decoded.format() != self.original_format {
            warn!("decoded format is actually {:?}", frame.decoded.format());
            self.original_format = frame.decoded.format();
            self.create_scaler()?;
        }

        // av_frame_alloc
        let mut processed = frame::VideoData::empty();
        // sws_scale
        check!(self.scaler.run(&frame.decoded, &mut processed))?;
        frame.decoded = processed;
        self.frames.push_back(frame);
        Ok(())
    }
}

impl Player {
    pub fn create(decoder: &Decoder) -> Result<Self, MediaError> {
        let format = if decoder.accelerator.as_ref().is_some() {
            format::Pixel::NV12 // TODO: I just guessed one
        } else {
            decoder.inner.format()
        };

        let (w, h) = (decoder.inner.width(), decoder.inner.height());
        let scaling_method = scaling::Flags::FAST_BILINEAR;

        Ok(Self {
            original_format: format,
            original_size: (w, h),
            output_size: (w, h),
            scaling_method,
            scaler: check!(scaling::Context::get(
                format, w, h,
                format::Pixel::RGBA,
                decoder.inner.width()
                    .rescale(Rational(1, 1), decoder.sample_aspect_ratio())
                    .try_into()
                    .unwrap(),
                h,
                scaling_method,
            ))?,
            frames: VecDeque::new()
        })
    }

    pub fn get_delta(&mut self) -> VecDeque<frame::Video> {
        std::mem::take(&mut self.frames)
    }

    pub fn set_output_size(&mut self, size: (u32, u32)) -> Result<(), MediaError> {
        if self.output_size == size {
            return Ok(());
        }

        self.output_size = size;
        self.create_scaler()?;
        debug!("set_output_size: {:?}, format {:?}", size, self.original_format);
        Ok(())
    }

    fn create_scaler(&mut self) -> Result<(), MediaError> {
        self.scaler = check!(scaling::Context::get(
            self.original_format,
            self.original_size.0,
            self.original_size.1,
            format::Pixel::RGBA,
            self.output_size.0,
            self.output_size.1,
            self.scaling_method,
        ))?;
        Ok(())
    }
}

pub struct Sampler {
    frames: BTreeMap<Timestamp, isize>,
    keyframes: BTreeMap<Timestamp, isize>,
    known_range: DisjointIntervalSet<Timestamp>,
    data: Option<SamplerDeltaData>
}

#[derive(Clone, serde::Serialize, Debug, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
#[ts(rename = "VideoSamplerDeltaData")]
pub struct SamplerDeltaData {
    pub keyframes: Vec<(Seconds, isize)>,
    pub start_time: Seconds,
    pub end_time: Seconds
}

impl VideoSink for Sampler {
    fn clear(&mut self) {
        self.data = None;
    }

    fn is_empty(&self) -> bool {
        self.data.is_none()
    }

    fn process(&mut self, frame: frame::Video) -> Result<(), MediaError> {
        if self.data.is_none() {
            self.data = Some(SamplerDeltaData {
                keyframes: Vec::new(),
                start_time: frame.meta.time,
                end_time: frame.meta.time
            });
        }

        let timestamp = Timestamp::from_seconds(frame.meta.time, DEFAULT_TIMEBASE);

        self.frames.insert(timestamp, frame.meta.byte_pos);

        let sd = self.data.as_mut().unwrap();
        if frame.decoded.is_key() {
            sd.keyframes.push((frame.meta.time, frame.meta.byte_pos));
            self.keyframes.insert(timestamp, frame.meta.byte_pos);
        }
        if frame.meta.time > sd.end_time {
            sd.end_time = frame.meta.time;
            self.known_range.add(
                Timestamp::from_seconds(sd.start_time, DEFAULT_TIMEBASE), 
                timestamp
            );
        }
        Ok(())
    }
}

impl Sampler {
    #[allow(clippy::unnecessary_wraps)]
    pub fn create(_decoder: &Decoder) -> Result<Self, MediaError> {
        Ok(Self {
            frames: BTreeMap::new(),
            keyframes: BTreeMap::new(),
            known_range: DisjointIntervalSet::new(),
            data: None
        })
    }

    pub fn get_delta(&mut self) -> Option<SamplerDeltaData> {
        std::mem::take(&mut self.data)
    }

    pub fn get_keyframe_before(&self, time: Seconds) -> Option<(Seconds, isize)> {
        let timestamp = Timestamp::from_seconds(time, DEFAULT_TIMEBASE);
        if let Some((&t, &pos)) = 
            self.keyframes.range(..=timestamp).next_back()
        && self.known_range.covers_range(t, timestamp)
        {
            Some((t.to_seconds(DEFAULT_TIMEBASE), pos))
        } else {
            None
        }
    }

    pub fn get_frame_before(&self, time: Seconds) -> Option<(Seconds, isize)> {
        let timestamp = Timestamp::from_seconds(time, DEFAULT_TIMEBASE);
        if let Some((&t, &pos)) = 
            self.frames.range(..timestamp).next_back()
        && self.known_range.covers_range(t, timestamp)
        {
            Some((t.to_seconds(DEFAULT_TIMEBASE), pos))
        } else {
            None
        }
    }
}