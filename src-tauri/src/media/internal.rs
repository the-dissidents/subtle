extern crate ffmpeg_next as ffmpeg;

use core::fmt;
use ffmpeg::decoder;
use ffmpeg::format::Pixel;
use ffmpeg::threading::Type;
use ffmpeg::Stream;
use ffmpeg_sys_next::AV_NOPTS_VALUE;
use serde::Serialize;
use std::cmp;

use ffmpeg::error::EAGAIN;
use ffmpeg::software::resampling;
use ffmpeg::software::scaling;
use ffmpeg::{codec, format, frame, media, rescale, software, ChannelLayout, Rational, Rescale};
use log::debug;
use log::trace;
use log::warn;

use crate::media::accel;
use crate::media::accel::HardwareDecoder;
use crate::media::aggregation_tree::AggregationTree;

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
            MediaError::FFMpegError { func, e, line } 
                => write!(f, "at {line}: {func}: {e}"),
            MediaError::InternalError(msg) 
                => write!(f, "internal error: {msg}"),
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
pub struct StreamDescription {
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
    pub pktpos: i64,
    pub time: f64,
    pub decoded: frame::Audio,
}

#[derive(Clone, Serialize, Debug)]
pub struct AudioSampleData {
    pub start: usize,
    pub position: i64,
    pub intensity: Vec<f32>
}

#[derive(Clone, Serialize, Debug)]
pub struct VideoSampleData {
    pub start: usize,
    pub keyframes: Vec<u8>
}

pub struct StreamInfo {
    index: usize,
    timebase: Rational,
    /// in stream timebase
    start_time: i64,
}

pub struct AudioBase {
    stream: StreamInfo,

    /// = `sample_rate` ^ -1 (assuming CFR)
    sample_timebase: Rational,
    sample_rate: u32,

    length: usize,
    decoder: codec::decoder::Audio,
}

pub struct AudioPlayerFront {
    resampler: resampling::Context,
}

pub struct AudioSamplerFront {
    resampler: resampling::Context,
    step: u32,
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
    stream: StreamInfo,

    /// = rate ^ -1 (assuming CFR)
    pos_timebase: Rational,

    /// will be inaccurate in case of VFR
    framerate: Rational,

    n_frames: usize,

    sample_aspect_ratio: Rational,
    original_size: (u32, u32),
    decoder: codec::decoder::Video,
    accelerator: Option<accel::HardwareDecoder>
}

pub struct VideoPlayerFront {
    original_format: format::Pixel,
    original_size: (u32, u32),
    output_size: (u32, u32),
    scaling_method: scaling::Flags,
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
        debug!("got input from {path}");
        Ok(MediaPlayback {
            input,
            audio: None,
            video: None,
        })
    }

    pub fn describe_streams(&self) -> Vec<StreamDescription> {
        let mut streams = Vec::<StreamDescription>::new();
        for stream in self.input.streams() {
            let metadata = stream.metadata();
            let lang = metadata.get("language").unwrap_or("--");
            streams.push(StreamDescription {
                r#type: match stream.parameters().medium() {
                    media::Type::Video => StreamType::Video,
                    media::Type::Audio => StreamType::Audio,
                    media::Type::Subtitle => StreamType::Subtitle,
                    media::Type::Data | media::Type::Unknown | media::Type::Attachment
                        => StreamType::Unknown,
                },
                index: stream.index(),
                description: format!("[{}] {}", stream.index(), lang),
            });
        }
        streams
    }

    #[allow(clippy::cast_precision_loss)]
    pub fn duration(&self) -> f64 {
        self.input.duration() as f64 * f64::from(rescale::TIME_BASE)
    }

    fn create_stream_info(
        &self, index: Option<usize>, kind: media::Type
    ) -> Result<(StreamInfo, Stream<'_>), MediaError> {
        let index = match index {
            Some(x) => x,
            None => self
                .input
                .streams()
                .best(kind)
                .ok_or(MediaError::InternalError(
                    format!("create_stream_info: no stream of type {kind:?}"))
                )?
                .index(),
        };

        let stream = self.input.stream(index).ok_or(MediaError::InternalError(
            format!("create_stream_info: [{index}] invalid stream index"),
        ))?;

        let timebase = stream.time_base();

        let start_time: i64 = match stream.start_time() {
            AV_NOPTS_VALUE => {
                warn!("create_stream_info: [{index}] invalid start_time");
                0
            },
            0 => 0,
            x => {
                warn!("create_stream_info: [{index}] stream has a start_time of {x}");
                x
            }
        };

        Ok((
            StreamInfo {
                index,
                timebase,
                start_time,
            },
            stream
        ))
    }

    fn create_video_base(
        &self, index: Option<usize>, accel: bool
    ) -> Result<VideoBase, MediaError> {
        let (stream_info, stream) = 
            self.create_stream_info(index, media::Type::Video)?;
        let index = stream_info.index;

        let codec = decoder::find(stream.parameters().id()).ok_or(
            MediaError::InternalError(
                format!("codec not found: {:?}", stream.parameters().id()),
        ))?;

        // create decoder
        let mut decoder_ctx = codec::Context::new_with_codec(codec).decoder();

        decoder_ctx.set_threading(codec::threading::Config { 
            kind: Type::Frame, 
            count: num_cpus::get()
        });
        debug!("create_video_base: codec = {:?}, using {} threads", 
            decoder_ctx.codec().map(|x| x.id()),
            num_cpus::get());

        let accelerator_name = 
            if !accel { "" }
            else if cfg!(windows) { "d3d11va" }
            else if cfg!(target_os = "macos") { "videotoolbox" }
            else { "" };
        let accelerator = 
            if accel::HardwareDecoder::available_types()
                .iter().any(|x| x == accelerator_name)
            {
                match accel::HardwareDecoder::create(
                        accelerator_name, &mut decoder_ctx) {
                    Ok(x) => {
                        debug!("create_video_base: using accelerator: {}", x.name());
                        Some(x)
                    },
                    Err(e) => {
                        debug!("create_video_base: error creating accelerator: {e}, falling back");
                        None
                    }
                }
            } else { None };

        check!(decoder_ctx.set_parameters(stream.parameters()))?; // avcodec_parameters_to_context
        let decoder = check!(decoder_ctx.video())?;        // avcodec_open2

        let sample_aspect_ratio = match decoder.aspect_ratio() {
            Rational(0, _) => Rational(1, 1),
            x => if f64::from(x) <= 0.0 { Rational(1, 1) } else { x  }
        };

        if sample_aspect_ratio != Rational(1, 1) {
            debug!("create_video_base: [{index}] note: video has an SAR of {sample_aspect_ratio:?}");
        }

        let timebase = stream.time_base();
        let avg_framerate = stream.avg_frame_rate(); // avg_frame_rate
        let framerate = stream.rate();            // r_frame_rate
        if framerate != avg_framerate {
            warn!("create_video_base: [{index}] note: stream is VFR, avg={avg_framerate}, rate={framerate}");
        }
        let pos_timebase = framerate.invert();

        let duration: usize = match stream.duration() {
            x if x > 0 => x,
            _ => {
                let duration = self.input.duration();
                warn!("create_video_base: [{index}] falling back to context duration = {duration}");
                duration.rescale(rescale::TIME_BASE, timebase)
            },
        }
        .try_into().unwrap();

        let n_frames: usize = match stream.frames() {
            x if x > 0 => x,
            _ => {
                warn!("create_video_base: [{index}] deriving frame count from duration, may be inaccurate");
                i64::try_from(duration)
                    .unwrap()
                    .rescale(timebase, pos_timebase)
            }
        }
        .try_into().unwrap();

        debug!(
            "create_video_base: [{}] {:?}; decoder_fr={:?}",
            stream_info.index,
            decoder.format(), decoder.frame_rate()
        );

        Ok(VideoBase {
            stream: stream_info,
            pos_timebase,
            framerate,
            n_frames,
            original_size: (decoder.width(), decoder.height()),
            sample_aspect_ratio,
            decoder, accelerator,
        })
    }

    pub fn open_video(
        &mut self, index: Option<usize>, accel: bool
    ) -> Result<(), MediaError> {
        let base = self.create_video_base(index, accel)?;

        let format = if base.accelerator.as_ref().is_some() {
            Pixel::NV12 // TODO: I just guessed one
        } else {
            base.decoder.format()
        };
        
        let front = VideoFront::Player(VideoPlayerFront {
            original_format: format,
            original_size: (base.decoder.width(), base.decoder.height()),
            output_size: (base.decoder.width(), base.decoder.height()),
            scaling_method: scaling::Flags::FAST_BILINEAR,
            scaler: check!(scaling::Context::get(
                format,
                base.decoder.width(),
                base.decoder.height(),
                format::Pixel::RGBA,
                base.decoder
                    .width()
                    .rescale(Rational(1, 1), base.sample_aspect_ratio)
                    .try_into()
                    .unwrap(),
                base.decoder.height(),
                scaling::Flags::FAST_BILINEAR,
            ))?,
        });

        self.video = Some(VideoContext { base, front });
        Ok(())
    }

    pub fn open_video_sampler(
        &mut self, index: Option<usize>, accel: bool
    ) -> Result<(), MediaError> {
        let base = self.create_video_base(index, accel)?;

        let front = VideoFront::Sampler(VideoSamplerFront {
            keyframes: AggregationTree::new(base.n_frames, cmp::max, 0),
        });

        self.video = Some(VideoContext { base, front });
        Ok(())
    }

    fn create_audio_base(&self, index: Option<usize>) -> Result<AudioBase, MediaError> {
        let (stream_info, stream) = 
            self.create_stream_info(index, media::Type::Audio)?;

        // create decoder
        let codecxt = check!(codec::Context::from_parameters(stream.parameters()))?;
        let mut decoder = check!(codecxt.decoder().audio())?;
        check!(decoder.set_parameters(stream.parameters()))?;
        decoder.set_packet_time_base(stream.time_base());

        let timebase = decoder.time_base();
        if timebase != Rational(1, decoder.rate().try_into().unwrap()) {
            warn!("create_audio_base: time_base = {timebase} but rate = {}", decoder.rate());
        }

        let length: usize = self
            .input
            .duration()
            .rescale(rescale::TIME_BASE, timebase)
            .try_into()
            .unwrap();

        debug!(
            "create_audio_base: [{}] len={}, decoder_tb={}, stream_tb={}, format={}, layout=0x{:x}",
            stream_info.index,
            length,
            timebase,
            stream.time_base(),
            decoder.format().name(),
            decoder.channel_layout().bits()
        );

        Ok(AudioBase {
            stream: stream_info,
            length,
            sample_timebase: timebase,
            sample_rate: decoder.rate(),
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
                    base.sample_rate
                ),
                (
                    format::Sample::F32(format::sample::Type::Packed),
                    ChannelLayout::MONO,
                    base.sample_rate,
                ),
            ))?,
        });

        self.audio = Some(AudioContext { base, front });
        Ok(())
    }

    pub fn open_audio_sampler(
        &mut self,
        index: Option<usize>,
        resolution: u32,
    ) -> Result<(), MediaError> {
        let base = self.create_audio_base(index)?;

        let step = base.sample_rate.div_ceil(resolution);
        let front = AudioFront::Sampler(AudioSamplerFront {
            resampler: check!(software::resampler(
                (
                    base.decoder.format(),
                    base.decoder.channel_layout(),
                    base.sample_rate
                ),
                (
                    format::Sample::F32(format::sample::Type::Packed),
                    ChannelLayout::MONO,
                    base.sample_rate,
                ),
            ))?,
            intensities: AggregationTree::new(
                base.length.div_ceil(step as usize),
                f32::max,
                f32::NAN,
            ),
            step
        });

        self.audio = Some(AudioContext { base, front });
        log::debug!("opening audio sampler: ok");
        Ok(())
    }

    /// Returns Ok(None) at EOF
    pub fn get_next(&mut self) -> Result<Option<Frame>, MediaError> {
        assert!(self.audio.is_some() || self.video.is_some());

        for (stream, packet) in self.input.packets() {
            if let Some(c) = self.audio.as_mut() {
                if c.base.stream.index == stream.index() {
                    // decode audio packet
                    c.feed(&packet)?;
                    if let Some(f) = c.decode()? {
                        return Ok(Some(Frame::Audio(f)));
                    }
                }
            }
            if let Some(c) = self.video.as_mut() {
                if c.base.stream.index == stream.index() {
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
    pub fn sample_next(&mut self, 
        audio_data: &mut Option<AudioSampleData>,
        video_data: &mut Option<VideoSampleData>
    ) -> Result<Option<Frame>, MediaError> {
        assert!(self.audio.is_some() || self.video.is_some());
        match self.get_next()? {
            Some(Frame::Audio(f)) => 
            match self.audio_mut().unwrap().front_mut() {
                AudioFront::Sampler(s) => {
                    s.process(&f, audio_data)?;
                    Ok(Some(Frame::Audio(f)))
                }
                AudioFront::Player(_) => Err(MediaError::InternalError(
                    "audio not opened as sampler".to_string()))
            },
            Some(Frame::Video(f)) => 
            match self.video_mut().unwrap().front_mut() {
                VideoFront::Sampler(s) => {
                    s.process(&f, video_data);
                    Ok(Some(Frame::Video(f)))
                }
                VideoFront::Player(_) => Err(MediaError::InternalError(
                    "video not opened as sampler".to_string()))
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

        let rescaled = position.rescale(
            cxt.base.pos_timebase, 
            cxt.base.stream.timebase);
        trace!("seek video: pos={position}, rescaled={rescaled}");

        unsafe {
            match ffmpeg_sys_next::avformat_seek_file(
                self.input.as_mut_ptr(),
                cxt.base.stream.index.try_into().unwrap(),
                0,
                rescaled,
                rescaled,
                ffmpeg_sys_next::AVSEEK_FLAG_BACKWARD,
            ) {
                s if s >= 0 => Ok(()),
                e => Err(MediaError::InternalError(
                    format!("seek_video: avformat_seek_file -> {e}"))),
            }
        }
    }

    pub fn seek_audio(&mut self, position: i64) -> Result<(), MediaError> {
        let cxt = self
            .audio
            .as_mut()
            .ok_or(MediaError::InternalError("no audio".to_string()))?;
        cxt.flush();

        let rescaled = position.rescale(
            cxt.base.sample_timebase, 
            cxt.base.stream.timebase);
        trace!("seek audio: pos={position}, rescaled={rescaled}");

        unsafe {
            match ffmpeg_sys_next::avformat_seek_file(
                self.input.as_mut_ptr(),
                cxt.base.stream.index.try_into().unwrap(),
                0,
                rescaled,
                rescaled,
                ffmpeg_sys_next::AVSEEK_FLAG_BACKWARD,
            ) {
                s if s >= 0 => Ok(()),
                e => Err(MediaError::InternalError(
                    format!("seek_audio: avformat_seek_file -> {e}"))),
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
    pub fn process(
        &mut self, frame: &DecodedAudioFrame, 
        sampler_data: &mut Option<AudioSampleData>
    ) -> Result<(), MediaError> {
        let mut index: usize = match frame.position / i64::from(self.step) {
            y if y >= 0 && usize::try_from(y).unwrap() >= self.intensities.length => {
                log::debug!("AudioSamplerFront.process: unexpected {y}, expecting < {}", self.intensities.length);
                return Ok(());
            },
            y if y >= 0 => y.try_into().unwrap(),
            _ => return Ok(())
        };
        if sampler_data.is_none() {
            *sampler_data = Some(AudioSampleData {
                start: index,
                position: 0,
                intensity: Vec::<f32>::new()
            });
        }

        let sd = sampler_data.as_mut().unwrap();
        let mut processed = frame::Audio::empty();
        check!(self.resampler.run(&frame.decoded, &mut processed))?;
        
        let data: &[f32] = processed.plane(0);
        let step = i64::from(self.step);
        let mut position = frame.position;
        let mut sum: f32 = self.intensities.at(index);

        for sample in data {
            sum = sum.max(sample.abs());
            if position % step == 0 {
                self.intensities.set(&[sum], index);

                match sd.start + sd.intensity.len() {
                    x if x > index => {
                        // log::debug!("AudioSamplerFront.process: unexpected {x}, expecting {index}; revising");
                        sd.intensity[index - sd.start] = sum;
                    },
                    x => { // x == index
                        if x < index {
                            // log::debug!("AudioSamplerFront.process: unexpected {x}, expecting {index}; filling with zeroes");
                            while sd.start + sd.intensity.len() < index {
                                sd.intensity.push(0.);
                            }
                        }
                        sd.intensity.push(sum);
                    }
                }
                
                index += 1;
                if index >= self.intensities.length {
                    return Ok(());
                }
                sum = self.intensities.at(index);
            }
            position += 1;
        }
        self.intensities.set(&[sum], index);
        sd.position = frame.position + i64::try_from(frame.decoded.samples()).unwrap();
        Ok(())
    }

    pub fn data_view(&self, level: usize) -> &[f32] {
        self.intensities.get_level(level)
    }
}

impl AudioContext {
    fn feed(&mut self, packet: &codec::packet::Packet) -> Result<(), MediaError> {
        match self.base.decoder.send_packet(packet) {
            Ok(()) => Ok(()),
            Err(ffmpeg_next::Error::Other { errno: EAGAIN }) => {
                // discard buffer
                warn!("fill: EAGAIN met when sending audio pkt, flushing");
                self.base.decoder.flush();
                Ok(())
            }
            send_packet_error => check!(send_packet_error),
        }
    }

    fn flush(&mut self) {
        self.base.decoder.flush();
    }

    #[allow(clippy::cast_precision_loss)]
    pub fn decode(&mut self) -> Result<Option<DecodedAudioFrame>, MediaError> {
        let mut decoded = frame::Audio::empty();
        match self.base.decoder.receive_frame(&mut decoded) {
            Ok(()) => (),
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
            .rescale(self.base.stream.timebase, 
                self.base.sample_timebase);

        let time = f64::from(self.base.sample_timebase) * position as f64;

        Ok(Some(DecodedAudioFrame {
            position,
            time,
            pktpos: decoded.packet().position,
            decoded,
        }))
    }

    pub fn stream_index(&self) -> usize {
        self.base.stream.index
    }

    pub fn length(&self) -> usize {
        self.base.length
    }

    #[allow(clippy::cast_precision_loss)]
    pub fn start_time(&self) -> f64 {
        f64::from(self.base.stream.timebase) * self.base.stream.start_time as f64
    }

    pub fn sample_rate(&self) -> u32 {
        self.base.sample_rate
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
        if frame.decoded.format() != self.original_format {
            log::warn!("decoded format is actually {:?}", frame.decoded.format());
            self.original_format = frame.decoded.format();
            self.create_scaler()?;
        }

        // av_frame_alloc
        let mut processed = frame::Video::empty();
        // sws_scale
        check!(self.scaler.run(&frame.decoded, &mut processed))?;
        frame.decoded = processed;
        Ok(frame)
    }

    pub fn set_output_size(&mut self, size: (u32, u32)) -> Result<(), MediaError> {
        if self.output_size == size {
            return Ok(());
        }

        self.output_size = size;
        self.create_scaler()?;
        debug!("set output size: {:?}, format {:?}", size, self.original_format);
        Ok(())
    }

    fn create_scaler(&mut self) -> Result<(), MediaError> {
        // sws_getContext
        self.scaler = scaling::Context::get(
            self.original_format,
            self.original_size.0,
            self.original_size.1,
            format::Pixel::RGBA,
            self.output_size.0,
            self.output_size.1,
            self.scaling_method,
        )
        .map_err(|x| 
            MediaError::InternalError(format!("Can't create scaler: {x}")))?;
        Ok(())
    }
}

impl VideoSamplerFront {
    pub fn process(&mut self, frame: &DecodedVideoFrame, 
        sampler_data: &mut Option<VideoSampleData>
    ) {
        let index: usize = match frame.position {
            y if y >= 0 && usize::try_from(y).unwrap() >= self.keyframes.length => {
                log::debug!("VideoSamplerFront.process: unexpected {y}, expecting < {}", self.keyframes.length);
                return;
            },
            x if x >= 0 => x.try_into().unwrap(),
            _ => return
        };
        if sampler_data.is_none() {
            *sampler_data = Some(VideoSampleData { 
                start: index, 
                keyframes: Vec::<u8>::new()
            });
        }
        let sd = sampler_data.as_mut().unwrap();
        let value = if frame.decoded.is_key() { 2 } else { 1 };
        self.keyframes.set(&[value], index);
        if sd.start + sd.keyframes.len() <= index {
            sd.keyframes.push(value);
        } else {
            sd.keyframes[index - sd.start] = value;
        }
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
            Ok(()) => Ok(()),
            Err(ffmpeg_next::Error::Other { errno: EAGAIN }) => {
                // discard buffer
                warn!("fill: EAGAIN met when sending video pkt, flushing");
                self.base.decoder.flush();
                Ok(())
            }
            send_packet_error => check!(send_packet_error),
        }
    }

    fn flush(&mut self) {
        self.base.decoder.flush();
    }

    #[allow(clippy::cast_precision_loss)]
    fn decode(&mut self) -> Result<Option<DecodedVideoFrame>, MediaError> {
        let mut decoded = frame::Video::empty();
        match self.base.decoder.receive_frame(&mut decoded) {
            Ok(()) => {}
            Err(ffmpeg_next::Error::Other { errno: EAGAIN }) => {
                // trace!("receive: EAGAIN");
                return Ok(None);
            }
            receive_frame_error => check!(receive_frame_error)?,
        }

        let position = decoded
            .pts()
            // fall back to packet's DTS if no pts available (as in AVI)
            .unwrap_or(decoded.packet().dts)
            .rescale(self.base.stream.timebase, 
                self.base.pos_timebase);

        let time = f64::from(self.base.pos_timebase) * position as f64;

        if self.base.accelerator.is_some() {
            let mut sw_frame = frame::Video::empty();
            check!(HardwareDecoder::transfer_frame(&decoded, &mut sw_frame))?;
            decoded = sw_frame;
        }

        Ok(Some(DecodedVideoFrame {
            position,
            time,
            decoded,
        }))
    }

    pub fn stream_index(&self) -> usize {
        self.base.stream.index
    }

    #[allow(clippy::cast_precision_loss)]
    pub fn start_time(&self) -> f64 {
        f64::from(self.base.stream.timebase) * self.base.stream.start_time as f64
    }

    pub fn n_frames(&self) -> usize {
        self.base.n_frames
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

#[cfg(test)]
mod tests {
    use std::time::Instant;

    use crate::media::{accel, internal::{Frame, VideoFront}, MediaPlayback};

    #[test]
    fn configuration() {
        ffmpeg::init().unwrap();
        println!("{}", ffmpeg::util::configuration());
    }

    #[test]
    fn performance() {
        eprintln!("list of available accelerators:");
        for t in accel::HardwareDecoder::available_types() {
            println!("-- {t}");
        }

        let path = "E:\\Rural Landscape.mp4";
        // let path = "/Users/emf/Downloads/Rural Landscape.mp4";
        let mut playback = MediaPlayback::from_file(path).unwrap();
        playback.open_video(None, false).unwrap();
        playback.open_audio(None).unwrap();
        if let VideoFront::Player(x) = playback.video_mut().unwrap().front_mut() {
            x.set_output_size((768, 432)).unwrap();
        }
        println!("reading frames");
        let start = Instant::now();
        let mut i = 0;
        let mut iv = 0;
        let mut ia = 0;
        while i < 10000 {
            match playback.get_next().unwrap() {
                Some(Frame::Video(_f)) => {
                    // if let VideoFront::Player(x) = playback.video_mut().unwrap().front_mut() {
                    //     x.process(f).unwrap();
                    // }
                    iv += 1;
                }
                Some(Frame::Audio(_f)) => {
                    // if let AudioFront::Player(x) = playback.audio_mut().unwrap().front_mut() {
                    //     x.process(f).unwrap();
                    // }
                    ia += 1;
                }
                None => break,
            }
            i += 1;
        }
        println!("read {i} frames ({iv} video, {ia} audio) in {}s", start.elapsed().as_secs_f32());
    }
}