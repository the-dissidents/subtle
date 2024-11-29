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

pub struct CachedFrame {
    pub position: i64,
    pub decoded: frame::Video,
    pub scaled: Option<frame::Video>
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

    state: ContextState,
    current: Option<CachedFrame>
}

pub struct MediaPlayback {
    input: Box<format::context::Input>,
    audio: Option<AudioContext>,
    video: Option<VideoContext>
}

fn print_frame_debug_date(frame: &frame::Video, incipit: &str) {
    println!("{} ts={:?}:pts={:?}:planes={}:format={:?}", 
        incipit,
        frame.timestamp(), 
        frame.pts(),
        frame.planes(),
        frame.format());
}

impl VideoContext {
    pub fn scale_current_frame(&mut self) -> Result<(), String> {
        let cache = self.current.as_mut().ok_or("No current frame")?;
        let mut scaled = frame::Video::empty();
        self.scaler.run(&cache.decoded, &mut scaled)
            .or_else(|x| Err(format!("Scaler failed: {x}")))?;
        cache.scaled = Some(scaled);
        // print_frame_debug_date(&cache.scaled, "video: scaled frame:");
        Ok(())
    }

    pub fn try_receive_frame(&mut self) -> Result<(), String> {
        if self.state == ContextState::EOF {
            return Ok(());
        }

        let mut cache = CachedFrame {
            position: -1,
            decoded: frame::Video::empty(),
            scaled: None
        };

        if self.decoder.receive_frame(&mut cache.decoded).is_err() {
            self.state = ContextState::NeedPacket;
            return Ok(());
        }
        // print_frame_debug_date(&cache.decoded, "video: decoded frame:");
        cache.position = cache.decoded.pts()
            .ok_or("decoded frame has no pts")?
            .rescale(self.stream_timebase, self.pos_timebase);
        self.current = Some(cache);
        // self.scale_current_frame()?;

        Ok(())
    }

    pub fn set_output_size(&mut self, size: (u32, u32)) -> Result<(), String>  {
        if self.output_size == size { return Ok(()); }

        let (width, height) = size;
        self.scaler = scaling::Context::get(
            self.decoder.format(),
            self.decoder.width(),
            self.decoder.height(),
            Pixel::RGBA,
            width, height,
            scaling::Flags::BILINEAR,
        ).or_else(|x| Err(format!("Can't create scaler: {x}")))?;
        
        self.output_size = size;
        if let Some(cached) = self.current.as_mut() {
            cached.scaled = None;
        }
        println!("set output size: {:?}", size);
        Ok(())
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

    pub fn pos_timebase(&self) -> Rational {
        self.pos_timebase
    }

    pub fn stream_index(&self) -> usize {
        self.stream_i
    }

    pub fn length(&self) -> i64 {
        self.length
    }

    pub fn current(&self) -> Option<&CachedFrame> {
        self.current.as_ref()
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

    // pub fn audio_mut(&mut self) -> Option<&mut AudioContext> {
    //     self.audio.as_mut()
    // }

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
            None => self.input.streams().best(media::Type::Video)
                .ok_or("No video stream".to_string())?.index(),
        };
        let stream = self.input.stream(index)
            .ok_or("Can't open video stream".to_string())?;

        // create decoder
        let codecxt = 
            codec::Context::from_parameters(stream.parameters())
            .or_else(|x| Err(format!("Can't create codec context: {x}")))?;

        let mut decoder = 
            codecxt.decoder().video()
            .or_else(|x| Err(format!("Can't create decoder: {x}")))?;

        decoder.set_parameters(stream.parameters())
            .or_else(|x| Err(format!("Can't set parameters: {x}")))?;
        
        let stream_avgfr = stream.avg_frame_rate();
        let stream_rfr = stream.rate();
        let decoder_fr = decoder.frame_rate();
        println!("video: avgfr={stream_avgfr}:rfr={stream_rfr}; decoder: fr={:?}", decoder_fr);
        // we decide to use r_frame_rate

        let scaler = scaling::Context::get(
            decoder.format(),
            decoder.width(),
            decoder.height(),
            Pixel::RGBA,
            decoder.width(),
            decoder.height(),
            scaling::Flags::BILINEAR,
        ).or_else(|x| Err(format!("Can't create scaler: {x}")))?;

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
            state: ContextState::NeedPacket,
            framerate: stream_rfr,
            current: None,
            length, decoder, scaler
        });
        Ok(())
    }

    pub fn open_audio(&mut self, index: Option<usize>) -> Result<(), String> {
        let index = match index {
            Some(x) => x,
            None => self.input.streams().best(media::Type::Audio)
                .ok_or("No audio stream".to_string())?.index(),
        };
        let stream = match self.input.stream(index) {
            Some(s) => s,
            None => return Err("Can't open audio stream".to_string()),
        };

        // create decoder
        let codecxt = 
            codec::Context::from_parameters(stream.parameters())
            .or_else(|x| Err(format!("Can't create codec context: {x}")))?;

        let mut decoder = 
            codecxt.decoder().audio()
            .or_else(|x| Err(format!("Can't create decoder: {x}")))?;

         decoder.set_parameters(stream.parameters())
            .or_else(|x| Err(format!("Can't set parameters: {x}")))?;

        // resampler
        let resampler = software::resampler(
            (decoder.format(), decoder.channel_layout(), decoder.rate()),
            (
                format::Sample::F32(format::sample::Type::Packed),
                ChannelLayout::MONO,
                decoder.rate(),
            ),
        ).or_else(|x| Err(format!("Can't create resampler: {x}")))?;

        let invert_rate = 
            ffmpeg::Rational::new(decoder.rate().try_into().unwrap(), 1);
        // if I understand correctly, we can actually remove this as it holds by definition
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

    pub fn update_current_video_frame(&mut self) -> Result<(), String> {
        let cxt = self.video.as_mut()
            .ok_or("No video opened".to_string())?;

        if cxt.current.is_none() {
            if cxt.state != ContextState::EOF {
                self.advance_to_next_video_frame()?;
                return Ok(());
            }
        }

        if cxt.current.as_ref().unwrap().scaled.is_none() {
            cxt.scale_current_frame()?;
        }
        Ok(())
    }

    pub fn advance_to_next_video_frame(&mut self) -> Result<(), String> {
        let cxt = self.video.as_mut()
            .ok_or("No video opened".to_string())?;

        cxt.current = None;
        cxt.try_receive_frame()?;
        if cxt.state == ContextState::EOF {
            return Err("already at EOF".to_string());
        }
        if cxt.current.is_none() {
            self.fill_packets()?;
            return self.advance_to_next_video_frame();
        };
        Ok(())
        // self.update_current_video_frame()
    }

    pub fn next_audio_frame(&mut self) -> Result<Option<frame::Audio>, String> {
        let cxt = self.audio.as_mut()
            .ok_or("No audio opened".to_string())?;

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
                let cxt = self.audio.as_mut().unwrap();
                if let Err(e) = cxt.decoder.send_packet(&packet) {
                    return Err(e.to_string());
                };
                cxt.state = ContextState::HasPacket;
                audio_id = -1;
            } else if video_id >= 0 && stream.index() == video_id as usize {
                let cxt = self.video.as_mut().unwrap();
                if let Err(e) = cxt.decoder.send_packet(&packet) {
                    return Err(e.to_string());
                };
                cxt.state = ContextState::HasPacket;
                cxt.current = None;
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

    fn clear_packets(&mut self) {
        if let Some(ctx) = self.audio.as_mut() {
            ctx.position = -1;
            ctx.state = ContextState::NeedPacket;
            ctx.decoder.flush();
        }
        if let Some(ctx) = self.video.as_mut() {
            ctx.current = None;
            ctx.state = ContextState::NeedPacket;
            ctx.decoder.flush();
        }
    }

    pub fn seek_video(&mut self, position: i64) -> Result<(), String> {
        // TODO: if very close to current position then don't seek at all
        self.clear_packets();
        let video = self.video.as_ref().ok_or("No video".to_string())?;

        let rescaled = position.rescale(
            video.pos_timebase, 
            video.stream_timebase);
        // println!("seek: pos={}, rescaled={}", position, rescaled);

        unsafe {
            match ffmpeg_sys_next::avformat_seek_file(
                self.input.as_mut_ptr(),
                video.stream_i as i32,
                0,
                rescaled,
                rescaled,
                0,
            ) {
                s if s >= 0 => Ok(()),
                e => Err(format!("Seek failed: {e}")),
            }
        }
    }

    pub fn seek_audio(&mut self, position: i64) -> Result<(), String> {
        // TODO: if very close to current position then don't seek at all
        self.clear_packets();

        let cxt = self.audio.as_ref().ok_or("No audio".to_string())?;
        let rescaled = position.rescale(
            cxt.pos_timebase, 
            rescale::TIME_BASE);
        self.input.seek(rescaled, ..rescaled)
            .or_else(|x| Err(format!("Seek failed: {x}")))?;
        Ok(())
    }
}

// is this ok?
unsafe impl Send for MediaPlayback {}
