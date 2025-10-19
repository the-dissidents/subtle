use crate::media::{audio::{self, AudioSink}, demux, internal::MediaError, units, video::{self, VideoSink}};

pub struct Session {
    demuxer: demux::Demuxer,
    audio: Option<(audio::Decoder, audio::AudioSinkKind)>,
    video: Option<(video::Decoder, video::VideoSinkKind)>
}

impl Session {
    pub fn demuxer(&self) -> &demux::Demuxer {
        &self.demuxer
    }
    pub fn audio(&self) -> Option<&(audio::Decoder, audio::AudioSinkKind)> {
        self.audio.as_ref()
    }
    pub fn video(&self) -> Option<&(video::Decoder, video::VideoSinkKind)> {
        self.video.as_ref()
    }
    pub fn audio_mut(&mut self) -> Option<&mut (audio::Decoder, audio::AudioSinkKind)> {
        self.audio.as_mut()
    }
    pub fn video_mut(&mut self) -> Option<&mut (video::Decoder, video::VideoSinkKind)> {
        self.video.as_mut()
    }
}

unsafe impl Send for Session {}

impl Session {
    pub fn create(path: &std::path::Path) -> Result<Self, MediaError> {
        Ok(Self {
            demuxer: demux::Demuxer::open(path)?,
            audio: None,
            video: None,
        })
    }

    fn flush(&mut self) {
        if let Some((d, s)) = self.audio.as_mut() {
            d.flush();
            s.clear();
        }
        if let Some((d, s)) = self.video.as_mut() {
            d.flush();
            s.clear();
        }
    }

    pub fn seek(&mut self, time: units::Seconds) -> Result<(), MediaError> {
        self.demuxer.seek(time)?;
        self.flush();
        Ok(())
    }

    pub fn seek_byte_pos(&mut self, pos: i64) -> Result<(), MediaError> {
        self.demuxer.seek_byte_pos(pos)?;
        self.flush();
        Ok(())
    }

    pub fn seek_audio(&mut self, time: units::Seconds) -> Result<(), MediaError> {
        let (d, _c) = self.audio.as_ref().unwrap();
        self.demuxer.seek_stream(time, d.stream_info())?;
        self.flush();
        Ok(())
    }

    pub fn seek_video(&mut self, time: units::Seconds) -> Result<(), MediaError> {
        let (d, _c) = self.video.as_ref().unwrap();
        self.demuxer.seek_stream(time, d.stream_info())?;
        self.flush();
        Ok(())
    }

    pub fn open_audio_player(&mut self, index: Option<usize>) -> Result<(), MediaError> {
        let decoder = audio::Decoder::create(&self.demuxer, index)?;
        let sink = audio::Player::create(&decoder)?;
        self.audio = Some((decoder, sink.into()));
        Ok(())
    }

    pub fn open_video_player(
        &mut self, index: Option<usize>, accel: bool
    ) -> Result<(), MediaError> {
        let decoder = video::Decoder::create(&self.demuxer, index, accel)?;
        let sink = video::Player::create(&decoder)?;
        self.video = Some((decoder, sink.into()));
        Ok(())
    }

    pub fn open_audio_sampler(
        &mut self, index: Option<usize>, sample_per_second: usize
    ) -> Result<(), MediaError> {
        let decoder = audio::Decoder::create(&self.demuxer, index)?;
        let sink = audio::Sampler::create(&decoder, sample_per_second)?;
        self.audio = Some((decoder, sink.into()));
        Ok(())
    }

    pub fn open_video_sampler(&mut self, index: Option<usize>) -> Result<(), MediaError> {
        let decoder = video::Decoder::create(&self.demuxer, index, false)?;
        let sink = video::Sampler::create(&decoder)?;
        self.video = Some((decoder, sink.into()));
        Ok(())
    }

    /// returns `Ok(false)` on EOF
    pub fn try_feed(&mut self) -> Result<bool, MediaError> {
        let Some((i, packet)) = self.demuxer.next_packet() else {
            return Ok(false);
        };
        if let Some((d, _)) = self.audio_mut()
            && d.stream_info().index() == i
        {
            d.feed(&packet)?;
        }
        if let Some((d, _)) = self.video_mut()
            && d.stream_info().index() == i
        {
            d.feed(&packet)?;
        }
        Ok(true)
    }

    pub fn try_process(&mut self) -> Result<i32, MediaError> {
        self.try_process_skipping_before(units::Seconds(f64::NEG_INFINITY))
    }

    pub fn try_process_skipping_before(&mut self, when: units::Seconds) -> Result<i32, MediaError> {
        let mut count = 0;
        if let Some((d, c)) = self.audio_mut()
            && let Some(f) = d.try_receive()?
            && f.meta.time >= when
        {
            c.process(f)?;
            count += 1;
        }
        if let Some((d, c)) = self.video_mut()
            && let Some(f) = d.try_receive()?
            && f.meta.time >= when
        {
            c.process(f)?;
            count += 1;
        }
        Ok(count)
    }
}