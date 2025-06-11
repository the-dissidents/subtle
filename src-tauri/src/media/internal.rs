extern crate ffmpeg_next as ffmpeg;

use core::fmt;
use serde::Serialize;
use std::cmp;

use ffmpeg::error::EAGAIN;
use ffmpeg::software::resampling;
use ffmpeg::software::scaling;
use ffmpeg::{codec, format, frame, media, rescale, software, ChannelLayout, Rational, Rescale};
use log::debug;
use log::trace;
use log::warn;

use crate::media::aggregation_tree::AggregationTree;

const AUDIO_SAMPLER_RATE: u32 = 48000;

#[derive(Debug)]
pub enum MediaError {
    FFMpegError {
        func: String,
        e: ffmpeg::Error,
        line: u32,
    },
    InternalError(String),
}

impl fmt::Display for MediaError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MediaError::FFMpegError { func, e, line } => write!(f, "at {}: {}: {}", line, func, e),
            MediaError::InternalError(msg) => write!(f, "internal error: {}", msg),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StreamType {
    Audio,
    Video,
    Subtitle,
    Unknown,
}

#[derive(Clone, Debug, Serialize)]
pub struct StreamInfo {
    r#type: StreamType,
    index: usize,
    description: String,
}

pub struct DecodedVideoFrame {
    pub position: i64,
    pub time: f64,
    pub decoded: frame::Video,
}

pub struct DecodedAudioFrame {
    pub position: i64,
    pub time: f64,
    pub decoded: frame::Audio,
}

pub struct AudioBase {
    stream_i: usize,
    stream_timebase: Rational,
    pos_timebase: Rational, // = rate ^ -1
    length: usize,
    decoder: codec::decoder::Audio,
}

pub struct AudioPlayerFront {
    resampler: resampling::Context,
}

pub struct AudioSamplerFront {
    resampler: resampling::Context,
    step: usize, scale: f64,
    intensities: AggregationTree<f32, fn(f32, f32) -> f32>,
}

pub enum AudioFront {
    Player(AudioPlayerFront),
    Sampler(AudioSamplerFront),
}

pub struct AudioContext {
    base: AudioBase,
    front: AudioFront,
}

pub enum Frame {
    Audio(DecodedAudioFrame),
    Video(DecodedVideoFrame),
}

pub struct VideoBase {
    stream_i: usize,
    stream_timebase: Rational,
    pos_timebase: Rational, // = framerate ^ -1
    framerate: Rational,
    sample_aspect_ratio: Rational,
    original_size: (u32, u32),
    length: usize,
    decoder: codec::decoder::Video,
}

pub struct VideoPlayerFront {
    original_format: format::Pixel,
    original_size: (u32, u32),
    output_size: (u32, u32),
    scaler: scaling::Context,
}

pub struct VideoSamplerFront {
    keyframes: AggregationTree<u8, fn(u8, u8) -> u8>,
}

pub enum VideoFront {
    Player(VideoPlayerFront),
    Sampler(VideoSamplerFront),
}

pub struct VideoContext {
    base: VideoBase,
    front: VideoFront,
}

pub struct MediaPlayback {
    input: Box<format::context::Input>,
    audio: Option<AudioContext>,
    video: Option<VideoContext>,
}

// Required by tauri. Is this ok?
unsafe impl Send for MediaPlayback {}

macro_rules! check {
    ($e:expr) => {
        $e.map_err(|e| MediaError::FFMpegError {
            func: stringify!($e).to_string(),
            line: line!(),
            e,
        })
    };
}

impl MediaPlayback {
    pub fn audio(&self) -> Option<&AudioContext> {
        self.audio.as_ref()
    }

    pub fn audio_mut(&mut self) -> Option<&mut AudioContext> {
        self.audio.as_mut()
    }

    pub fn video(&self) -> Option<&VideoContext> {
        self.video.as_ref()
    }

    pub fn video_mut(&mut self) -> Option<&mut VideoContext> {
        self.video.as_mut()
    }

    pub fn from_file(path: &str) -> Result<MediaPlayback, MediaError> {
        let input = Box::new(check!(format::input(&path))?);
        debug!("got input from {}", path);
        Ok(MediaPlayback {
            input,
            audio: None,
            video: None,
        })
    }

    pub fn describe_streams(&self) -> Vec<StreamInfo> {
        let mut streams = Vec::<StreamInfo>::new();
        for stream in self.input.streams() {
            let metadata = stream.metadata();
            let lang = metadata.get("language").unwrap_or("--");
            streams.push(StreamInfo {
                r#type: match stream.parameters().medium() {
                    media::Type::Video => StreamType::Video,
                    media::Type::Audio => StreamType::Audio,
                    media::Type::Subtitle => StreamType::Subtitle,
                    media::Type::Data => StreamType::Unknown,
                    media::Type::Unknown => StreamType::Unknown,
                    media::Type::Attachment => StreamType::Unknown,
                },
                index: stream.index(),
                description: format!("[{}] {}", stream.index(), lang),
            });
        }
        streams
    }

    pub fn duration(&self) -> f64 {
        self.input.duration() as f64 * f64::from(rescale::TIME_BASE)
    }

    fn create_video_base(&self, index: Option<usize>) -> Result<VideoBase, MediaError> {
        let index = match index {
            Some(x) => x,
            None => self
                .input
                .streams()
                .best(media::Type::Video)
                .ok_or(MediaError::InternalError("No video stream".to_string()))?
                .index(),
        };
        let stream = self.input.stream(index).ok_or(MediaError::InternalError(
            "invalid stream index".to_string(),
        ))?;

        // create decoder
        let codecxt = check!(codec::Context::from_parameters(stream.parameters()))?;
        let mut decoder = check!(codecxt.decoder().video())?;
        check!(decoder.set_parameters(stream.parameters()))?;

        let stream_avgfr = stream.avg_frame_rate();
        let stream_rfr = stream.rate();
        let decoder_fr = decoder.frame_rate();
        debug!(
            "video: avgfr={stream_avgfr}:rfr={stream_rfr}; decoder: fr={:?}",
            decoder_fr
        );
        // we decide to use r_frame_rate

        let sample_aspect_ratio = match decoder.aspect_ratio() {
            Rational(0, _) => Rational(1, 1),
            x => {
                if f64::from(x) <= 0.0 {
                    Rational(1, 1)
                } else {
                    x
                }
            }
        };

        if sample_aspect_ratio != Rational(1, 1) {
            debug!("note: SAR is {:?}", sample_aspect_ratio);
        }

        let length: usize = match stream.duration() {
            x if x > 0 => x,
            _ => self
                .input
                .duration()
                .rescale(rescale::TIME_BASE, stream_rfr.invert()),
        }
        .try_into()
        .unwrap();

        Ok(VideoBase {
            stream_i: index,
            stream_timebase: stream.time_base(),
            pos_timebase: stream_rfr.invert(),
            original_size: (decoder.width(), decoder.height()),
            framerate: stream_rfr,
            sample_aspect_ratio,
            length,
            decoder,
        })
    }

    pub fn open_video(&mut self, index: Option<usize>) -> Result<(), MediaError> {
        let base = self.create_video_base(index)?;

        let front = VideoFront::Player(VideoPlayerFront {
            original_format: base.decoder.format(),
            original_size: (base.decoder.width(), base.decoder.height()),
            output_size: (base.decoder.width(), base.decoder.height()),
            scaler: check!(scaling::Context::get(
                base.decoder.format(),
                base.decoder.width(),
                base.decoder.height(),
                format::Pixel::RGBA,
                base.decoder
                    .width()
                    .rescale(Rational(1, 1), base.sample_aspect_ratio)
                    .try_into()
                    .unwrap(),
                base.decoder.height(),
                scaling::Flags::BILINEAR,
            ))?,
        });

        self.video = Some(VideoContext { base, front });
        Ok(())
    }

    pub fn open_video_sampler(&mut self, index: Option<usize>) -> Result<(), MediaError> {
        let base = self.create_video_base(index)?;

        let front = VideoFront::Sampler(VideoSamplerFront {
            keyframes: AggregationTree::new(base.length, |a, b| cmp::max(a, b), 0),
        });

        self.video = Some(VideoContext { base, front });
        Ok(())
    }

    fn create_audio_base(&self, index: Option<usize>) -> Result<AudioBase, MediaError> {
        let index = match index {
            Some(x) => x,
            None => self
                .input
                .streams()
                .best(media::Type::Audio)
                .ok_or(MediaError::InternalError("No audio stream".to_string()))?
                .index(),
        };
        let stream = self.input.stream(index).ok_or(MediaError::InternalError(
            "invalid stream index".to_string(),
        ))?;

        // create decoder
        let codecxt = check!(codec::Context::from_parameters(stream.parameters()))?;
        let mut decoder = check!(codecxt.decoder().audio())?;
        check!(decoder.set_parameters(stream.parameters()))?;
        decoder.set_packet_time_base(stream.time_base());

        let length: usize = self
            .input
            .duration()
            .rescale(rescale::TIME_BASE, decoder.time_base())
            .try_into()
            .unwrap();

        debug!(
            "audio {}:len={};stream_tb={};decoder_tb={};rate={};format={};layout=0x{:x}",
            index,
            length,
            stream.time_base(),
            decoder.time_base(),
            decoder.rate(),
            decoder.format().name(),
            decoder.channel_layout().bits()
        );

        Ok(AudioBase {
            stream_i: index,
            stream_timebase: stream.time_base(),
            pos_timebase: decoder.time_base(),
            length,
            decoder,
        })
    }

    pub fn open_audio(&mut self, index: Option<usize>) -> Result<(), MediaError> {
        let base = self.create_audio_base(index)?;

        let front = AudioFront::Player(AudioPlayerFront {
            resampler: check!(software::resampler(
                (
                    base.decoder.format(),
                    base.decoder.channel_layout(),
                    base.decoder.rate()
                ),
                (
                    format::Sample::F32(format::sample::Type::Packed),
                    ChannelLayout::MONO,
                    base.decoder.rate(),
                ),
            ))?,
        });

        self.audio = Some(AudioContext { base, front });
        Ok(())
    }

    pub fn open_audio_sampler(
        &mut self,
        index: Option<usize>,
        step: usize,
    ) -> Result<(), MediaError> {
        let base = self.create_audio_base(index)?;

        let scale = AUDIO_SAMPLER_RATE as f64 / base.decoder.rate() as f64 / step as f64;
        log::debug!("opening audio sampler: {} -> {} at {}; scale {}", 
            base.decoder.rate(), AUDIO_SAMPLER_RATE, step, scale);
        let front = AudioFront::Sampler(AudioSamplerFront {
            resampler: check!(software::resampler(
                (
                    base.decoder.format(),
                    base.decoder.channel_layout(),
                    base.decoder.rate()
                ),
                (
                    format::Sample::F32(format::sample::Type::Packed),
                    ChannelLayout::MONO,
                    AUDIO_SAMPLER_RATE,
                ),
            ))?,
            intensities: AggregationTree::new(
                (base.length as f64 / scale).ceil() as usize,
                |a, b| a.max(b),
                f32::NAN,
            ),
            step, scale
        });

        self.audio = Some(AudioContext { base, front });
        Ok(())
    }

    /// Returns Ok(None) at EOF
    pub fn get_next(&mut self) -> Result<Option<Frame>, MediaError> {
        assert!(self.audio.is_some() || self.video.is_some());

        for (stream, packet) in self.input.packets() {
            if let Some(c) = self.audio.as_mut() {
                if c.base.stream_i == stream.index() {
                    // decode audio packet
                    c.feed(&packet)?;
                    if let Some(f) = c.decode()? {
                        return Ok(Some(Frame::Audio(f)));
                    }
                }
            }
            if let Some(c) = self.video.as_mut() {
                if c.base.stream_i == stream.index() {
                    // decode video packet
                    c.feed(&packet)?;
                    if let Some(f) = c.decode()? {
                        return Ok(Some(Frame::Video(f)));
                    }
                }
            }
        }
        Ok(None)
    }

    // returns false at eof
    pub fn sample_next(&mut self) -> Result<Option<Frame>, MediaError> {
        assert!(self.audio.is_some() || self.video.is_some());
        match self.get_next()? {
            Some(Frame::Audio(f)) => match self.audio_mut().unwrap().front_mut() {
                AudioFront::Sampler(s) => {
                    s.process(&f)?;
                    Ok(Some(Frame::Audio(f)))
                }
                _ => {
                    return Err(MediaError::InternalError(
                        "audio not opened as sampler".to_string(),
                    ))
                }
            },
            Some(Frame::Video(f)) => match self.video_mut().unwrap().front_mut() {
                VideoFront::Sampler(s) => {
                    s.process(&f)?;
                    Ok(Some(Frame::Video(f)))
                }
                _ => {
                    return Err(MediaError::InternalError(
                        "video not opened as sampler".to_string(),
                    ))
                }
            },
            None => Ok(None),
        }
    }

    pub fn seek_video(&mut self, position: i64) -> Result<(), MediaError> {
        let cxt = self
            .video
            .as_mut()
            .ok_or(MediaError::InternalError("no video".to_string()))?;
        cxt.flush();

        let rescaled = position.rescale(cxt.base.pos_timebase, cxt.base.stream_timebase);
        trace!("seek video: pos={}, rescaled={}", position, rescaled);

        unsafe {
            match ffmpeg_sys_next::avformat_seek_file(
                self.input.as_mut_ptr(),
                cxt.base.stream_i as i32,
                0,
                rescaled,
                rescaled,
                ffmpeg_sys_next::AVSEEK_FLAG_BACKWARD,
            ) {
                s if s >= 0 => Ok(()),
                e => Err(MediaError::InternalError(format!(
                    "seek_video: avformat_seek_file -> {}",
                    e
                ))),
            }
        }
    }

    pub fn seek_audio(&mut self, position: i64) -> Result<(), MediaError> {
        let cxt = self
            .audio
            .as_mut()
            .ok_or(MediaError::InternalError("no audio".to_string()))?;
        cxt.flush();

        let rescaled = position.rescale(cxt.base.pos_timebase, cxt.base.stream_timebase);
        trace!("seek audio: pos={}, rescaled={}", position, rescaled);

        unsafe {
            match ffmpeg_sys_next::avformat_seek_file(
                self.input.as_mut_ptr(),
                cxt.base.stream_i as i32,
                0,
                rescaled,
                rescaled,
                ffmpeg_sys_next::AVSEEK_FLAG_BACKWARD,
            ) {
                s if s >= 0 => Ok(()),
                e => Err(MediaError::InternalError(format!(
                    "seek_audio: avformat_seek_file -> {}",
                    e
                ))),
            }
        }
    }
}

impl AudioPlayerFront {
    pub fn process(
        &mut self,
        mut frame: DecodedAudioFrame,
    ) -> Result<DecodedAudioFrame, MediaError> {
        let mut processed = frame::Audio::empty();
        check!(self.resampler.run(&frame.decoded, &mut processed))?;
        frame.decoded = processed;
        Ok(frame)
    }
}

impl AudioSamplerFront {
    pub fn process(&mut self, frame: &DecodedAudioFrame) -> Result<(), MediaError> {
        let mut processed = frame::Audio::empty();
        check!(self.resampler.run(&frame.decoded, &mut processed))?;

        let index = (frame.position as f64 * self.scale).floor();
        let mut index: usize = match index {
            y if y >= 0.0 => y as usize,
            _ => return Ok(())
        };
        if index >= self.intensities.length {
            return Ok(());
        }

        let data: &[f32] = frame.decoded.plane(0);
        let mut counter = 0;
        let mut sum: f32 = self.intensities.at(index);
        for sample in data {
            sum = sum.max(sample.abs());
            counter += 1;
            if counter == self.step {
                self.intensities.set(&[sum], index);
                counter = 0;
                index += 1;
                if index >= self.intensities.length {
                    return Ok(());
                }
                sum = self.intensities.at(index);
            }
        }
        self.intensities.set(&[sum], index);
        Ok(())
    }

    pub fn data_view(&self, level: usize) -> &[f32] {
        self.intensities.get_level(level)
    }
}

impl AudioContext {
    fn feed(&mut self, packet: &codec::packet::Packet) -> Result<(), MediaError> {
        match self.base.decoder.send_packet(packet) {
            Ok(_) => Ok(()),
            Err(ffmpeg_next::Error::Other { errno: EAGAIN }) => {
                // discard buffer
                warn!("fill: EAGAIN met in sending audio pkt, flushing");
                self.base.decoder.flush();
                Ok(())
            }
            send_packet_error => check!(send_packet_error),
        }
    }

    fn flush(&mut self) {
        self.base.decoder.flush();
    }

    pub fn decode(&mut self) -> Result<Option<DecodedAudioFrame>, MediaError> {
        let mut decoded = frame::Audio::empty();
        match self.base.decoder.receive_frame(&mut decoded) {
            Ok(_) => (),
            Err(ffmpeg_next::Error::Other { errno: EAGAIN }) => {
                return Ok(None);
            }
            receive_frame_error => check!(receive_frame_error)?,
        }

        let position = decoded
            .pts()
            .ok_or(MediaError::InternalError(
                "decoded frame has no pts".to_owned(),
            ))?
            .rescale(self.base.stream_timebase, self.base.pos_timebase);
        let time = f64::from(self.base.pos_timebase) * position as f64;

        Ok(Some(DecodedAudioFrame {
            position,
            time,
            decoded,
        }))
    }

    pub fn stream_index(&self) -> usize {
        self.base.stream_i
    }

    pub fn length(&self) -> usize {
        self.base.length
    }

    pub fn sample_rate(&self) -> u32 {
        self.base.decoder.rate()
    }

    pub fn front(&self) -> &AudioFront {
        &self.front
    }

    pub fn front_mut(&mut self) -> &mut AudioFront {
        &mut self.front
    }
}

impl VideoPlayerFront {
    pub fn process(
        &mut self,
        mut frame: DecodedVideoFrame,
    ) -> Result<DecodedVideoFrame, MediaError> {
        let mut processed = frame::Video::empty();
        check!(self.scaler.run(&frame.decoded, &mut processed))?;
        frame.decoded = processed;
        Ok(frame)
    }

    pub fn set_output_size(&mut self, size: (u32, u32)) -> Result<(), String> {
        if self.output_size == size {
            return Ok(());
        }

        let (width, height) = size;
        self.scaler = scaling::Context::get(
            self.original_format,
            self.original_size.0,
            self.original_size.1,
            format::Pixel::RGBA,
            width,
            height,
            scaling::Flags::BILINEAR,
        )
        .map_err(|x| format!("Can't create scaler: {x}"))?;

        self.output_size = size;
        trace!("set output size: {:?}", size);
        Ok(())
    }
}

impl VideoSamplerFront {
    pub fn process(&mut self, frame: &DecodedVideoFrame) -> Result<(), MediaError> {
        let index: usize = match frame.position {
            x if x >= 0 => x.try_into().unwrap(),
            _ => return Ok(()),
        };
        if index >= self.keyframes.length {
            return Ok(());
        }
        self.keyframes
            .set(&[if frame.decoded.is_key() { 2 } else { 1 }], index);
        Ok(())
    }

    pub fn data_view(&self, level: usize) -> &[u8] {
        self.keyframes.get_level(level)
    }

    pub fn get_keyframe_before(&self, pos: usize) -> Option<usize> {
        let view = self.keyframes.get_leaf_level();
        let mut i = pos;
        loop {
            match view[i] {
                2 => return Some(i),
                1 => {}
                _ => return None,
            }
            if i == 0 {
                return None;
            }
            i -= 1;
        }
    }
}

impl VideoContext {
    fn feed(&mut self, packet: &codec::packet::Packet) -> Result<(), MediaError> {
        match self.base.decoder.send_packet(packet) {
            Ok(_) => Ok(()),
            Err(ffmpeg_next::Error::Other { errno: EAGAIN }) => {
                // discard buffer
                warn!("fill: EAGAIN met in sending video pkt, flushing");
                self.base.decoder.flush();
                Ok(())
            }
            send_packet_error => check!(send_packet_error),
        }
    }

    fn flush(&mut self) {
        self.base.decoder.flush();
    }

    fn decode(&mut self) -> Result<Option<DecodedVideoFrame>, MediaError> {
        let mut decoded = frame::Video::empty();
        match self.base.decoder.receive_frame(&mut decoded) {
            Ok(()) => {}
            Err(ffmpeg_next::Error::Other { errno: EAGAIN }) => {
                trace!("receive: EAGAIN");
                return Ok(None);
            }
            receive_frame_error => check!(receive_frame_error)?,
        }

        let position = decoded
            .pts()
            // fall back to packet's DTS if no pts available (as in AVI)
            .unwrap_or(decoded.packet().dts)
            .rescale(self.base.stream_timebase, self.base.pos_timebase);
        let time = f64::from(self.base.pos_timebase) * position as f64;
        trace!("receive: got frame {}", position);

        Ok(Some(DecodedVideoFrame {
            position,
            time,
            decoded,
        }))
    }

    // pub fn stream_index(&self) -> usize {
    //     self.base.stream_i
    // }

    pub fn length(&self) -> usize {
        self.base.length
    }

    pub fn original_size(&self) -> (u32, u32) {
        self.base.original_size
    }

    pub fn sample_aspect_ratio(&self) -> Rational {
        self.base.sample_aspect_ratio
    }

    pub fn framerate(&self) -> Rational {
        self.base.framerate
    }

    // pub fn pixel_format(&self) -> format::Pixel {
    //     self.base.decoder.format()
    // }

    pub fn front(&self) -> &VideoFront {
        &self.front
    }

    pub fn front_mut(&mut self) -> &mut VideoFront {
        &mut self.front
    }
}
