extern crate ffmpeg_next as ffmpeg;

use ffmpeg::format;
use ffmpeg::software;
use ffmpeg::software::resampling;
use ffmpeg::software::scaling;
use ffmpeg::{codec, frame, media, rescale, ChannelLayout, Rescale};
use ffmpeg_next::format::Pixel;
use ffmpeg_next::Rational;

#[derive(PartialEq)]
enum ContextState {
    NeedPacket,
    HasPacket,
    EOF,
}

pub struct AudioContext {
    stream_i: usize,
    decoder: codec::decoder::Audio,
    resampler: resampling::Context,

    stream_timebase: Rational,
    pos_timebase: Rational, // = rate ^ -1

    position: i64,
    length: i64,
    state: ContextState,
}

pub struct VideoContext {
    stream_i: usize,
    decoder: codec::decoder::Video,
    scaler: scaling::Context,

    stream_timebase: Rational,
    pos_timebase: Rational, // = framerate ^ -1

    framerate: Rational,
    output_size: (u32, u32),
    position: i64,
    length: i64,
    state: ContextState,
}

pub struct MediaPlayback {
    input: Box<format::context::Input>,
    audio: Option<AudioContext>,
    video: Option<VideoContext>
}

impl VideoContext {
    pub fn try_next_frame(&mut self) -> Result<Option<frame::Video>, String> {
        if self.state == ContextState::EOF {
            return Ok(None);
        }

        let mut decoded_frame = frame::Video::empty();
        if self.decoder.receive_frame(&mut decoded_frame).is_err() {
            self.state = ContextState::NeedPacket;
            return Ok(None);
        }

        self.position = decoded_frame.pts()
            .ok_or("decoded frame has no pts")?
            .rescale(self.stream_timebase, self.decoder.time_base());

        let mut transformed_frame = frame::Video::empty();
        match self.scaler.run(&decoded_frame, &mut transformed_frame) {
            Ok(_) => Ok(Some(transformed_frame)),
            Err(e) => Err(e.to_string())
        }
    }

    pub fn set_output_size(&mut self, size: (u32, u32)) -> Result<(), String>  {
        let (width, height) = size;
        self.scaler = match scaling::Context::get(
            self.decoder.format(),
            self.decoder.width(),
            self.decoder.height(),
            Pixel::RGB8,
            width, height,
            scaling::Flags::BILINEAR,
        ) {
            Ok(x) => x,
            Err(e) => return Err(e.to_string())
        };
        self.output_size = size;
        Ok(())
    }

    pub fn output_size(&self) -> (u32, u32) {
        return self.output_size;
    }

    pub fn framerate(&self) -> Rational {
        self.framerate
    }

    pub fn pos_timebase(&self) -> Rational {
        self.pos_timebase
    }

    pub fn stream_index(&self) -> usize {
        self.stream_i
    }

    pub fn length(&self) -> i64 {
        self.length
    }

    pub fn position(&self) -> i64 {
        self.position
    }

    pub fn decoder(&self) -> &codec::decoder::Video {
        &self.decoder
    }
}

impl AudioContext {
    pub fn try_next_frame(&mut self) -> Result<Option<frame::Audio>, String> {
        if self.state == ContextState::EOF {
            return Ok(None);
        }

        let mut decoded_frame = frame::Audio::empty();
        if self.decoder.receive_frame(&mut decoded_frame).is_err() {
            self.state = ContextState::NeedPacket;
            return Ok(None);
        }

        self.position = decoded_frame.pts()
            .ok_or("decoded frame has no pts")?
            .rescale(self.stream_timebase, self.decoder.time_base());

        let mut transformed_frame = frame::Audio::empty();
        match self.resampler.run(&decoded_frame, &mut transformed_frame) {
            Ok(_) => Ok(Some(transformed_frame)),
            Err(e) => Err(e.to_string())
        }
    }

    pub fn stream_index(&self) -> usize {
        self.stream_i
    }

    pub fn pos_timebase(&self) -> Rational {
        self.pos_timebase
    }

    pub fn length(&self) -> i64 {
        self.length
    }

    pub fn position(&self) -> i64 {
        self.position
    }

    pub fn decoder(&self) -> &codec::decoder::Audio {
        &self.decoder
    }
}

impl MediaPlayback {
    pub fn from_file(path: &str) -> Result<MediaPlayback, String> {
        let ictx = match format::input(&path) {
            Ok(i) => Box::new(i),
            Err(e) => return Err(e.to_string()),
        };
        Ok(MediaPlayback {
            input: ictx,
            audio: None,
            video: None,
        })
    }

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

    pub fn describe_streams(&self) -> Vec<String> {
        let mut streams = Vec::<String>::new();
        for stream in self.input.streams() {
            streams.push(format!(
                "{:?}; rate~{}",
                stream.parameters().medium(),
                stream.rate()
            ));
        }
        streams
    }

    pub fn duration(&self) -> f64 {
        self.input.duration() as f64 * f64::from(rescale::TIME_BASE)
    }

    pub fn open_video(&mut self, index: Option<usize>) -> Result<(), String> {
        let index = match index {
            Some(x) => x,
            None => match self.input.streams().best(media::Type::Video) {
                Some(x) => x.index(),
                None => return Err("No video streams".to_string()),
            },
        };
        let stream = match self.input.stream(index) {
            Some(s) => s,
            None => return Err("Can't open video stream".to_string()),
        };

        // create decoder
        let codecxt = match codec::Context::from_parameters(stream.parameters()) {
            Ok(ctx) => ctx,
            Err(e) => return Err(e.to_string()),
        };
        let mut decoder = match codecxt.decoder().video() {
            Ok(dec) => dec,
            Err(e) => return Err(e.to_string()),
        };
        if let Err(e) = decoder.set_parameters(stream.parameters()) {
            return Err(e.to_string());
        }
        
        let stream_avgfr = stream.avg_frame_rate();
        let stream_rfr = stream.rate();
        let decoder_fr = decoder.frame_rate();
        println!("video: avgfr={stream_avgfr}:rfr={stream_rfr}; decoder: fr={:?}", decoder_fr);
        // we decide to use r_frame_rate

        let scaler = match scaling::Context::get(
            decoder.format(),
            decoder.width(),
            decoder.height(),
            Pixel::RGB8,
            decoder.width(),
            decoder.height(),
            scaling::Flags::BILINEAR,
        ) {
            Ok(x) => x,
            Err(e) => return Err(e.to_string())
        };

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
            state: ContextState::NeedPacket,
            framerate: stream_rfr,
            position: -1,
            length, decoder, scaler
        });
        Ok(())
    }

    pub fn open_audio(&mut self, index: Option<usize>) -> Result<(), String> {
        let index = match index {
            Some(x) => x,
            None => match self.input.streams().best(media::Type::Audio) {
                Some(x) => x.index(),
                None => return Err("No audio streams".to_string()),
            },
        };
        let stream = match self.input.stream(index) {
            Some(s) => s,
            None => return Err("Can't open audio stream".to_string()),
        };

        // create decoder
        let codecxt = match codec::Context::from_parameters(stream.parameters()) {
            Ok(ctx) => ctx,
            Err(e) => return Err(e.to_string()),
        };
        let mut decoder = match codecxt.decoder().audio() {
            Ok(dec) => dec,
            Err(e) => return Err(e.to_string()),
        };
        if let Err(e) = decoder.set_parameters(stream.parameters()) {
            return Err(e.to_string());
        }

        // resampler
        let resampler = match software::resampler(
            (decoder.format(), decoder.channel_layout(), decoder.rate()),
            (
                format::Sample::F32(format::sample::Type::Packed),
                ChannelLayout::MONO,
                decoder.rate(),
            ),
        ) {
            Ok(c) => c,
            Err(e) => return Err(e.to_string()),
        };

        let invert_rate = 
            ffmpeg::Rational::new(decoder.rate().try_into().unwrap(), 1);
        assert!(f64::from(decoder.time_base() * invert_rate) == 1.0);

        println!("audio: stream_tb={};decoder_tb={};rate={}", stream.time_base(), decoder.time_base(), decoder.rate());

        self.audio = Some(AudioContext {
            stream_i: index,
            stream_timebase: stream.time_base(),
            pos_timebase: invert_rate,
            length: self.input.duration()
                .rescale(rescale::TIME_BASE, decoder.time_base()),
            position: -1,
            state: ContextState::NeedPacket,
            decoder, resampler
        });
        Ok(())
    }

    pub fn next_video_frame(&mut self) -> Result<Option<frame::Video>, String> {
        let cxt = match self.video.as_mut() {
            Some(x) => x,
            None => return Err("no video opened".to_string())
        };
        if let Some(f) = cxt.try_next_frame()? {
            return Ok(Some(f));
        } else if self.video.as_ref().unwrap().state == ContextState::EOF {
            return Ok(None);
        } else {
            self.fill_packets()?;
            return self.next_video_frame();
        }
    }

    pub fn next_audio_frame(&mut self) -> Result<Option<frame::Audio>, String> {
        let cxt = match self.audio.as_mut() {
            Some(x) => x,
            None => return Err("no video opened".to_string())
        };
        if let Some(f) = cxt.try_next_frame()? {
            return Ok(Some(f));
        } else if self.audio.as_ref().unwrap().state == ContextState::EOF {
            return Ok(None);
        } else {
            self.fill_packets()?;
            return self.next_audio_frame();
        }
    }

    fn fill_packets(&mut self) -> Result<(), String> {
        let mut audio_id: i32 = match &self.audio {
            Some(AudioContext { state: ContextState::HasPacket, .. }) 
                => return Err("unconsumed audio packet".to_string()),
            Some(c) => c.stream_i as i32,
            None => -1,
        };
        let mut video_id = match &self.video {
            Some(VideoContext { state: ContextState::HasPacket, .. }) 
                => return Err("unconsumed audio packet".to_string()),
            Some(c) => c.stream_i as i32,
            None => -1,
        };
        if audio_id < 0 && video_id < 0 {
            return Ok(());
        }

        // read packets
        for (stream, packet) in self.input.packets() {
            if audio_id >= 0 && stream.index() == audio_id as usize {
                if let Err(e) = self.audio.as_mut().unwrap().decoder.send_packet(&packet) {
                    return Err(e.to_string());
                };
                self.audio.as_mut().unwrap().state = ContextState::HasPacket;
                audio_id = -1;
            } else if video_id >= 0 && stream.index() == video_id as usize {
                if let Err(e) = self.video.as_mut().unwrap().decoder.send_packet(&packet) {
                    return Err(e.to_string());
                };
                self.video.as_mut().unwrap().state = ContextState::HasPacket;
                video_id = -1;
            }
            if audio_id < 0 && video_id < 0 {
                return Ok(());
            }
        }
        if audio_id >= 0 {
            self.audio.as_mut().unwrap().state = ContextState::EOF;
        }
        if video_id >= 0 {
            self.video.as_mut().unwrap().state = ContextState::EOF;
        }
        Ok(()) // eof
    }

    pub fn seek(&mut self, position: i64, base: Rational) -> Result<(), String> {
        if let Some(ctx) = self.audio.as_mut() {
            ctx.position = -1;
            ctx.state = ContextState::NeedPacket;
            ctx.decoder.flush();
        }
        if let Some(ctx) = self.video.as_mut() {
            ctx.position = -1;
            ctx.state = ContextState::NeedPacket;
            ctx.decoder.flush();
        }

        let rescaled = position.rescale(base, rescale::TIME_BASE);
        println!("seek: pos={}, rescaled={}", position, rescaled);
        if let Err(e) = self.input.seek(rescaled, ..rescaled) {
            return Err(e.to_string());
        }
        Ok(())
    }
}

// is this ok?
unsafe impl Send for MediaPlayback {}
