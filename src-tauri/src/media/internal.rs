extern crate ffmpeg_next as ffmpeg;

use core::fmt;

use ffmpeg::{codec, format, frame, media, rescale, software, ChannelLayout, Rational, Rescale};
use ffmpeg::software::resampling;
use ffmpeg::software::scaling;
use ffmpeg::error::EAGAIN;
use log::debug;
use log::trace;
use log::warn;

#[derive(Debug)]
pub enum MediaError {
    FFMpegError{ func: String, e: ffmpeg::Error, line: u32 },
    InternalError(String)
}

impl fmt::Display for MediaError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MediaError::FFMpegError{func, e, line } => 
                write!(f, "at {}: {}: {}", line, func, e),
            MediaError::InternalError(msg) => 
                write!(f, "internal error: {}", msg),
        }
    }
}

pub struct AudioContext {
    stream_i: usize,
    decoder: codec::decoder::Audio,
    resampler: resampling::Context,

    stream_timebase: Rational,
    pos_timebase: Rational, // = rate ^ -1
    length: i64,
}

pub struct DecodedVideoFrame {
    pub position: i64,
    pub time: f64,
    pub decoded: frame::Video,
    pub scaled: frame::Video
}

pub struct DecodedAudioFrame {
    pub position: i64,
    pub time: f64,
    pub decoded: frame::Audio,
}

pub enum DecodedFrame {
    Audio(DecodedAudioFrame),
    Video(DecodedVideoFrame)
}

pub struct VideoContext {
    stream_i: usize,
    decoder: codec::decoder::Video,
    scaler: scaling::Context,

    stream_timebase: Rational,
    pos_timebase: Rational, // = framerate ^ -1

    framerate: Rational,
    output_size: (u32, u32),
    original_size: (u32, u32),
    length: i64,
}
pub struct MediaPlayback {
    input: Box<format::context::Input>,
    audio: Option<AudioContext>,
    video: Option<VideoContext>,
    stream_timebases: Vec<Rational>
}

// Required by tauri. Is this ok?
unsafe impl Send for MediaPlayback {}

macro_rules! check {
    ($e:expr) => {
        $e.map_err(|e| MediaError::FFMpegError {
            func: stringify!($e).to_string(),
            line: line!(),
            e
        })
    }
}

impl MediaPlayback {
    pub fn audio(&self) -> Option<&AudioContext> {
        self.audio.as_ref()
    }

    // currently nothing requires a mutable audio context
    // pub fn audio_mut(&mut self) -> Option<&mut AudioContext> {
    //     self.audio.as_mut()
    // }

    pub fn video(&self) -> Option<&VideoContext> {
        self.video.as_ref()
    }

    pub fn video_mut(&mut self) -> Option<&mut VideoContext> {
        self.video.as_mut()
    }

    pub fn from_file(path: &str) -> Result<MediaPlayback, MediaError> {
        let ictx = Box::new(check!(format::input(&path))?);
        debug!("got input from {}", path);
        let mut tbs = Vec::<Rational>::new();
        for stream in ictx.streams() {
            tbs.push(stream.time_base());
        }
        Ok(MediaPlayback {
            input: ictx,
            audio: None,
            video: None,
            stream_timebases: tbs
        })
    }

    pub fn describe_streams(&self) -> Vec<String> {
        let mut streams = Vec::<String>::new();
        for stream in self.input.streams() {
            streams.push(format!(
                "{:?}:rate~{}",
                stream.parameters().medium(),
                stream.rate()
            ));
        }
        streams
    }

    pub fn duration(&self) -> f64 {
        self.input.duration() as f64 * f64::from(rescale::TIME_BASE)
    }

    pub fn open_video(&mut self, index: Option<usize>) -> Result<(), MediaError> {
        let index = match index {
            Some(x) => x,
            None => self.input.streams().best(media::Type::Video)
                .ok_or(MediaError::InternalError("No video stream".to_string()))?
                .index(),
        };
        let stream = self.input.stream(index)
            .ok_or(MediaError::InternalError("invalid stream index".to_string()))?;

        // create decoder

        let codecxt = check!(codec::Context::from_parameters(stream.parameters()))?;
        let mut decoder = check!(codecxt.decoder().video())?;
        check!(decoder.set_parameters(stream.parameters()))?;
        
        let stream_avgfr = stream.avg_frame_rate();
        let stream_rfr = stream.rate();
        let decoder_fr = decoder.frame_rate();
        debug!("video: avgfr={stream_avgfr}:rfr={stream_rfr}; decoder: fr={:?}", decoder_fr);
        // we decide to use r_frame_rate

        let scaler = check!(scaling::Context::get(
            decoder.format(),
            decoder.width(),
            decoder.height(),
            format::Pixel::RGBA,
            decoder.width(),
            decoder.height(),
            scaling::Flags::BILINEAR,
        ))?;

        let length = match stream.duration() {
            x if x > 0 => x,
            _ => self.input.duration()
                .rescale(rescale::TIME_BASE, stream_rfr.invert())
        };

        self.video = Some(VideoContext {
            stream_i: index,
            stream_timebase: stream.time_base(),
            pos_timebase: stream_rfr.invert(),
            output_size: (decoder.width(), decoder.height()),
            original_size: (decoder.width(), decoder.height()),
            framerate: stream_rfr,
            length, decoder, scaler
        });
        Ok(())
    }

    pub fn open_audio(&mut self, index: Option<usize>) -> Result<(), MediaError> {
        let index = match index {
            Some(x) => x,
            None => self.input.streams().best(media::Type::Audio)
                .ok_or(MediaError::InternalError("No audio stream".to_string()))?
                .index(),
        };
        let stream = self.input.stream(index)
            .ok_or(MediaError::InternalError("invalid stream index".to_string()))?;

        // create decoder
        let codecxt = check!(codec::Context::from_parameters(stream.parameters()))?;
        // hack to solve `Could not update timestamps for skipped samples.`
        let mut decoder = check!(codecxt.decoder().audio())?;
        // unsafe {
        //     (*decoder.as_mut_ptr()).pkt_timebase = 
        //         AVRational{ num: stream.time_base().0, den: stream.time_base().1 };
        // }
        check!(decoder.set_parameters(stream.parameters()))?;

        // resampler
        // TODO: support more than mono
        let resampler = check!(software::resampler(
            (decoder.format(), decoder.channel_layout(), decoder.rate()),
            (
                format::Sample::F32(format::sample::Type::Packed),
                ChannelLayout::MONO,
                decoder.rate(),
            ),
        ))?;

        let invert_rate = 
            ffmpeg::Rational::new(1, decoder.rate().try_into().unwrap());
        // if I understand correctly, we can actually remove this as it holds by definition
        assert!(decoder.time_base() == invert_rate);

        let length = self.input.duration()
            .rescale(rescale::TIME_BASE, decoder.time_base());

        debug!("audio {}:len={};stream_tb={};decoder_tb={};rate={};format={};layout=0x{:x}", 
            index, length,
            stream.time_base(), 
            decoder.time_base(), 
            decoder.rate(),
            decoder.format().name(),
            decoder.channel_layout().bits());

        self.audio = Some(AudioContext {
            stream_i: index,
            stream_timebase: stream.time_base(),
            pos_timebase: invert_rate,
            length,
            decoder, resampler
        });
        Ok(())
    }

    /// Returns Ok(None) at EOF
    pub fn get_next(&mut self) -> Result<Option<DecodedFrame>, MediaError>
    {
        assert!(self.audio.is_some() || self.video.is_some());

        for (stream, packet) in self.input.packets() {
            // TODO: skip until
            if let Some(c) = self.audio.as_mut() {
                if c.stream_i == stream.index() {
                    // decode audio packet
                    c.feed(&packet)?;
                    if let Some(f) = c.decode()? {
                        return Ok(Some(DecodedFrame::Audio(f)))
                    }
                }
            }
            if let Some(c) = self.video.as_mut() {
                if c.stream_i == stream.index() {
                    // decode video packet
                    c.feed(&packet)?;
                    if let Some(f) = c.decode()? {
                        return Ok(Some(DecodedFrame::Video(f)))
                    }
                }
            }
        }
        debug!("get_next: met EOF!");
        Ok(None)
    }

    pub fn seek_video(&mut self, position: i64) -> Result<(), MediaError> {
        let cxt = self.video.as_ref()
            .ok_or(MediaError::InternalError("no video".to_string()))?;
        let rescaled = position.rescale(
            cxt.pos_timebase, 
            cxt.stream_timebase);
        trace!("seek video: pos={}, rescaled={}", position, rescaled);

        unsafe {
            match ffmpeg_sys_next::avformat_seek_file(
                self.input.as_mut_ptr(),
                cxt.stream_i as i32,
                0,
                rescaled,
                rescaled,
                ffmpeg_sys_next::AVSEEK_FLAG_ANY,
            ) {
                s if s >= 0 => Ok(()),
                e => Err(MediaError::InternalError(
                    format!("seek_video: avformat_seek_file -> {}", e))),
            }
        }
    }

    pub fn seek_audio(&mut self, position: i64) -> Result<(), MediaError> {
        let cxt = self.audio.as_ref()
            .ok_or(MediaError::InternalError("no audio".to_string()))?;
        let rescaled = position.rescale(
            cxt.pos_timebase, 
            cxt.stream_timebase);
        trace!("seek audio: pos={}, rescaled={}", position, rescaled);

        unsafe {
            match ffmpeg_sys_next::avformat_seek_file(
                self.input.as_mut_ptr(),
                cxt.stream_i as i32,
                0,
                rescaled,
                rescaled,
                ffmpeg_sys_next::AVSEEK_FLAG_BACKWARD,
            ) {
                s if s >= 0 => Ok(()),
                e => Err(MediaError::InternalError(
                    format!("seek_audio: avformat_seek_file -> {}", e))),
            }
        }
    }

    pub fn seek_video_precise(&mut self, position: i64)
        -> Result<Option<DecodedVideoFrame>, MediaError>
    {
        // let guard = pprof::ProfilerGuardBuilder::default().frequency(1000).blocklist(&["libc", "libgcc", "pthread", "vdso"]).build().unwrap();

        self.seek_video(position)?;

        let cxt = self.video.as_mut()
            .ok_or(MediaError::InternalError("no video".to_string()))?;
        let mut n_advanced = 0;
        for (stream, packet) in self.input.packets() {
            if stream.index() == cxt.stream_i {
                cxt.feed(&packet)?;
                if let Some(f) = cxt.decode()? {
                    if f.position >= position {
                        debug!("seek_precise: advanced {} additional times", n_advanced);
                        debug!("seek_precise: arrived at {}", f.position);
                        return Ok(Some(f));
                    }
                }
                n_advanced += 1;
            }
        }
        Ok(None)

        // if let Ok(report) = guard.report().build() {
        //     let file = std::fs::File::create("debug/flamegraph.svg").unwrap();
        //     report.flamegraph(file).unwrap();
        // };
    }
}

impl AudioContext {
    fn feed(&mut self, packet: &codec::packet::Packet) -> Result<(), MediaError> {
        match self.decoder.send_packet(packet) {
            Ok(_) => Ok(()),
            Err(ffmpeg_next::Error::Other { errno: EAGAIN }) => {
                // discard buffer
                warn!("fill: EAGAIN met in sending audio pkt, flushing");
                self.decoder.flush();
                Ok(())
            },
            send_packet_error => check!(send_packet_error)
        }
    }

    pub fn decode(&mut self) -> Result<Option<DecodedAudioFrame>, MediaError> {
        let mut frame = DecodedAudioFrame {
            position: -1,
            time: -1.0,
            decoded: frame::Audio::empty()
        };

        let mut decoded_frame = frame::Audio::empty();
        match self.decoder.receive_frame(&mut decoded_frame) {
            Ok(_) => (),
            Err(ffmpeg_next::Error::Other { errno: EAGAIN }) => {
                return Ok(None);
            },
            receive_frame_error => check!(receive_frame_error)?
        }

        frame.position = decoded_frame.pts()
            .ok_or(MediaError::InternalError("decoded frame has no pts".to_owned()))?
            .rescale(self.stream_timebase, self.pos_timebase);
        frame.time = f64::from(self.pos_timebase) * frame.position as f64;

        check!(self.resampler.run(&decoded_frame, &mut frame.decoded))?;
        Ok(Some(frame))
    }

    pub fn stream_index(&self) -> usize {
        self.stream_i
    }

    pub fn length(&self) -> i64 {
        self.length
    }

    pub fn sample_rate(&self) -> u32 {
        self.decoder.rate()
    }
}

impl VideoContext {
    fn feed(&mut self, packet: &codec::packet::Packet) -> Result<(), MediaError> {
        match self.decoder.send_packet(packet) {
            Ok(_) => Ok(()),
            Err(ffmpeg_next::Error::Other { errno: EAGAIN }) => {
                // discard buffer
                warn!("fill: EAGAIN met in sending video pkt, flushing");
                self.decoder.flush();
                Ok(())
            },
            send_packet_error => check!(send_packet_error)
        }
    }

    fn decode(&mut self) -> Result<Option<DecodedVideoFrame>, MediaError> {
        let mut frame = DecodedVideoFrame {
            position: -1,
            time: -1.0,
            decoded: frame::Video::empty(),
            scaled: frame::Video::empty(),
        };

        match self.decoder.receive_frame(&mut frame.decoded) {
            Ok(()) => {
                frame.position = frame.decoded.pts()
                    // fall back to packet's DTS if no pts available (as in AVI)
                    .unwrap_or(frame.decoded.packet().dts)
                    .rescale(self.stream_timebase, self.pos_timebase);
                frame.time = f64::from(self.pos_timebase) * frame.position as f64;
                trace!("receive: got frame {}", frame.position);
            },
            Err(ffmpeg_next::Error::Other { errno: EAGAIN }) => {
                trace!("receive: EAGAIN");
                return Ok(None)
            },
            receive_frame_error => check!(receive_frame_error)?
        }

        check!(self.scaler.run(&frame.decoded, &mut frame.scaled))?;
        Ok(Some(frame))
    }

    pub fn set_output_size(&mut self, size: (u32, u32)) -> Result<(), String>  {
        if self.output_size == size { return Ok(()); }

        let (width, height) = size;
        self.scaler = scaling::Context::get(
            self.decoder.format(),
            self.decoder.width(),
            self.decoder.height(),
            format::Pixel::RGBA,
            width, height,
            scaling::Flags::BILINEAR,
        ).map_err(|x| format!("Can't create scaler: {x}"))?;
        
        self.output_size = size;
        trace!("set output size: {:?}", size);
        Ok(())
    }

    pub fn stream_index(&self) -> usize {
        self.stream_i
    }

    pub fn length(&self) -> i64 {
        self.length
    }

    pub fn output_size(&self) -> (u32, u32) {
        return self.output_size;
    }

    pub fn original_size(&self) -> (u32, u32) {
        return self.original_size;
    }

    pub fn framerate(&self) -> Rational {
        self.framerate
    }

    pub fn pixel_format(&self) -> format::Pixel {
        self.decoder.format()
    }
}