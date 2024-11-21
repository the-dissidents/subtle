extern crate ffmpeg_next as ffmpeg;

use ffmpeg::format;
use ffmpeg::software;
use ffmpeg::software::resampling;
use ffmpeg::{codec, frame, media, rescale, ChannelLayout, Rescale};
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
    position: i64,
    length: i64,
    state: ContextState,
}

impl AudioContext {
    pub fn stream_index(&self) -> usize {
        self.stream_i
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

pub struct MediaPlayback {
    input: Box<format::context::Input>,
    audio: Option<AudioContext>,
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
        })
    }

    pub fn audio(&self) -> Option<&AudioContext> {
        self.audio.as_ref()
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

        let pts_multiplier: f64 = (decoder.time_base()
            * ffmpeg::Rational::new(
                decoder.rate().try_into().unwrap(), 1)).into();
        if pts_multiplier != 1.0 {
            return Err("time_base not equal to 1/rate".to_string());
        }
        println!("stream timebase={}", stream.time_base());

        self.audio = Some(AudioContext {
            stream_i: index,
            stream_timebase: stream.time_base(),
            length: self
                .input
                .duration()
                .rescale(rescale::TIME_BASE, decoder.time_base()),
            position: -1,
            state: ContextState::NeedPacket,
            decoder,
            resampler,
        });
        Ok(())
    }

    fn try_next_audio_frame(&mut self) -> Result<Option<frame::Audio>, String> {
        let actx = match &mut self.audio {
            Some(a) => a,
            None => return Err("no audio opened".to_string()),
        };

        if actx.state == ContextState::EOF {
            return Ok(None);
        }
        let mut decoded_frame = frame::Audio::empty();
        if actx.decoder.receive_frame(&mut decoded_frame).is_err() {
            actx.state = ContextState::NeedPacket;
            return Ok(None);
        }

        actx.position = match decoded_frame.pts() {
            Some(x) => x.rescale(actx.stream_timebase, actx.decoder.time_base()),
            None => return Err("decoded frame has no pts".to_string()),
        };
        // println!("frame at {}, len={}", actx.position, decoded_frame.samples());

        let mut resampled_frame = frame::Audio::empty();
        match actx.resampler.run(&decoded_frame, &mut resampled_frame) {
            // there won't be any delay since sample rates are equal
            Ok(_) => {}
            Err(e) => return Err(e.to_string()),
        };
        Ok(Some(resampled_frame))
    }

    pub fn next_audio_frame(&mut self) -> Result<Option<frame::Audio>, String> {
        if self.audio.is_none() {
            return Err("no audio opened".to_string());
        }
        if let Some(f) = self.try_next_audio_frame()? {
            return Ok(Some(f));
        } else if self.audio.as_ref().unwrap().state == ContextState::EOF {
            return Ok(None);
        } else {
            self.fill_packets()?;
            return self.next_audio_frame();
        }
    }

    pub fn seek_audio(&mut self, position: i64) -> Result<(), String> {
        if let Some(actx) = self.audio.as_mut() {
            actx.position = -1;
            actx.state = ContextState::NeedPacket;
            actx.decoder.flush();
            let rescaled = position.rescale(actx.decoder.time_base(), rescale::TIME_BASE);
            // return Err(format!("pos={}, rescaled={}", position, rescaled));
            if let Err(e) = self.input.seek(rescaled, ..rescaled) {
                return Err(e.to_string());
            }
            Ok(())
        } else {
            Err("no audio opened".to_string())
        }
    }

    fn fill_packets(&mut self) -> Result<(), String> {
        let mut audio_id: i32 = match &self.audio {
            Some(c) => {
                if c.state == ContextState::HasPacket {
                    return Err("unconsumed audio packet".to_string());
                }
                c.stream_i as i32
            }
            None => -1,
        };
        let mut video_id = -1;
        if audio_id < 0 && video_id < 0 {
            return Ok(());
        }

        // read packets
        for (stream, packet) in self.input.packets() {
            if audio_id >= 0 && stream.index() == audio_id as usize {
                if let Err(e) = self.audio.as_mut().unwrap().decoder.send_packet(&packet) {
                    return Err(e.to_string());
                };
                // println!("sent PACKET at {}, len={}",
                //     packet.pts().unwrap_or(-1), packet.duration());
                self.audio.as_mut().unwrap().state = ContextState::HasPacket;
                audio_id = -1;
            } else if video_id >= 0 && stream.index() == video_id as usize {
                // don't have video yet
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
            // todo
        }
        Ok(()) // eof
    }
}

unsafe impl Send for MediaPlayback {}
