use ffmpeg::codec;
use ffmpeg_next::format;
use ffmpeg_sys_next::AV_NOPTS_VALUE;
use getset::{CopyGetters};
use log::{trace, warn};

use crate::media::{demux, internal::{check, MediaError}, units::{self, Seconds}};

pub use ffmpeg_next::packet::Packet;
pub use ffmpeg_next::media::Type as StreamKind;

#[derive(Clone, Debug, serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
#[ts(rename = "StreamKind")]
pub enum SerializableStreamKind {
    Audio,
    Video,
    Subtitle,
    Unknown,
}

#[derive(Clone, Debug, serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct StreamDescription {
    r#type: SerializableStreamKind,
    index: usize,
    language_code: String,
    codec_id: Option<String>
}

#[derive(Clone, Copy, CopyGetters)]
pub struct StreamInfo {
    #[getset(get_copy = "pub")]
    index: usize,

    #[getset(get_copy = "pub")]
    timebase: units::Rational,

    #[getset(get_copy = "pub")]
    start_time: units::Timestamp,

    pub byte_pos_can_update: bool,
    pub byte_pos: isize,
}

impl StreamInfo {
    pub fn start_time_seconds(&self) -> Seconds {
        self.start_time.to_seconds(self.timebase)
    }
}

pub struct Demuxer {
    input: Box<format::context::Input>
}

impl Demuxer {
    pub fn open(path: &std::path::Path) -> Result<Demuxer, MediaError> {
        let input = Box::new(check!(format::input(&path))?);
        Ok(Demuxer { input })
    }

    pub fn duration(&self) -> units::Seconds {
        units::Timestamp(self.input.duration()).to_seconds(units::DEFAULT_TIMEBASE)
    }

    pub fn describe_streams(&self) -> Vec<StreamDescription> {
        let mut streams = Vec::<StreamDescription>::new();
        for stream in self.input.streams() {
            let metadata = stream.metadata();
            let language_code = metadata.get("language")
                .unwrap_or("--")
                .to_owned();
            let codec_id = 
                codec::Context::from_parameters(stream.parameters())
                .ok()
                .and_then(|x|
                    x.codec().map(|c| c.id().name().to_owned()));
            streams.push(StreamDescription {
                r#type: match stream.parameters().medium() {
                    StreamKind::Video => SerializableStreamKind::Video,
                    StreamKind::Audio => SerializableStreamKind::Audio,
                    StreamKind::Subtitle => SerializableStreamKind::Subtitle,
                    _ => SerializableStreamKind::Unknown,
                },
                index: stream.index(),
                language_code,
                codec_id
            });
        }
        streams
    }

    pub fn get_stream_from_index(
        &self, index: usize
    ) -> Result<(demux::StreamInfo, ffmpeg_next::Stream<'_>), MediaError> {
        let stream = self.input.stream(index)
            .ok_or(MediaError::InternalError(
                format!("get_stream_from_index: [{index}] invalid stream index"))
            )?;

        let timebase = stream.time_base();

        let start_time = match stream.start_time() {
            AV_NOPTS_VALUE => {
                warn!("get_stream_from_index: [{index}] invalid start_time");
                units::Timestamp(0)
            },
            0 => units::Timestamp(0),
            x => {
                warn!("get_stream_from_index: [{index}] stream has a start_time of {x}");
                units::Timestamp(x)
            }
        };

        Ok((
            StreamInfo {
                index,
                timebase,
                start_time,
                byte_pos_can_update: true,
                byte_pos: -1
            },
            stream
        ))
    }

    pub fn get_stream_from_kind(
        &self, kind: StreamKind
    ) -> Result<(demux::StreamInfo, ffmpeg_next::Stream<'_>), MediaError> {
        let index = self
            .input
            .streams()
            .best(kind)
            .ok_or(MediaError::InternalError(
                format!("get_stream_from_kind: no stream of type {kind:?}"))
            )?
            .index();
        self.get_stream_from_index(index)
    }

    pub fn next_packet(&mut self) -> Option<(usize, Packet)> {
        if let Some((s, p)) = self.input.packets().next() {
            Some((s.index(), p))
        } else {
            None
        }
    }

    pub fn seek(&mut self, time: units::Seconds) -> Result<(), MediaError> {
        trace!("seek: [-1] time={time}");
        let units::Timestamp(rescaled) = 
            units::Timestamp::from_seconds(time, units::DEFAULT_TIMEBASE);
        check!(self.input.seek(rescaled, ..rescaled))?;
        Ok(())
    }


    pub fn seek_byte_pos(&mut self, pos: i64) -> Result<(), MediaError> {
        trace!("seek_byte_pos: pos={pos}");

        unsafe {
            match ffmpeg_sys_next::av_seek_frame(
                self.input.as_mut_ptr(),
                -1,
                pos,
                ffmpeg_sys_next::AVSEEK_FLAG_BYTE,
            ) {
                s if s >= 0 => Ok(()),
                e => Err(MediaError::InternalError(
                    format!("seek_byte_pos: avformat_seek_file -> {e}"))),
            }
        }
    }

    pub fn seek_stream(&mut self, time: Seconds, stream: &StreamInfo) -> Result<(), MediaError> {
        trace!("seek_stream: [{}] time={time}", stream.index);
        let units::Timestamp(rescaled) = 
            units::Timestamp::from_seconds(time, stream.timebase);

        unsafe {
            match ffmpeg_sys_next::avformat_seek_file(
                self.input.as_mut_ptr(),
                stream.index.try_into().unwrap(),
                0,
                rescaled,
                rescaled,
                ffmpeg_sys_next::AVSEEK_FLAG_BACKWARD,
            ) {
                s if s >= 0 => Ok(()),
                e => Err(MediaError::InternalError(
                    format!("seek_stream: avformat_seek_file -> {e}"))),
            }
        }
    }
}