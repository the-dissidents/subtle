use std::collections::VecDeque;

use ffmpeg::codec;
use ffmpeg::codec::subtitle;
use ffmpeg::error::EAGAIN;
use getset::{CopyGetters, Getters};
use log::warn;

use crate::media::{demux, internal::{MediaError, check}, units};

#[derive(Clone, Debug, serde::Serialize, ts_rs::TS)]
#[serde(rename = "BackendSubtitleRect", rename_all = "camelCase", tag = "type")]
#[ts(export)]
pub enum SubtitleRect {
    Ass { content: String },
    Text { content: String },
    Unsupported,
}

#[derive(Clone, Debug, serde::Serialize, ts_rs::TS)]
#[serde(rename = "BackendSubtitleEntry", rename_all = "camelCase")]
#[ts(export)]
pub struct SubtitleEntry {
    pub start: units::Seconds,
    pub end: units::Seconds,
    pub rects: Vec<SubtitleRect>,
}

#[derive(Getters, CopyGetters)]
pub struct Decoder {
    inner: codec::decoder::Subtitle,

    entries: VecDeque<SubtitleEntry>,

    #[getset(get = "pub")]
    stream_info: demux::StreamInfo,
}

impl Decoder {
    pub fn create(
        demuxer: &demux::Demuxer, index: Option<usize>
    ) -> Result<Decoder, MediaError> {
        let (stream_info, stream) = match index {
            Some(i) => demuxer.get_stream_from_index(i),
            None => demuxer.get_stream_from_kind(demux::StreamKind::Subtitle)
        }?;

        let codecxt = check!(codec::Context::from_parameters(stream.parameters()))?;
        let decoder = check!(codecxt.decoder().subtitle())?;

        Ok(Decoder { inner: decoder, stream_info, entries: VecDeque::new() })
    }

    pub fn flush(&mut self) {
        self.inner.flush();
        self.stream_info.byte_pos_can_update = true;
        self.stream_info.byte_pos = -1;
        self.entries.clear();
    }

    pub fn feed(&mut self, packet: &demux::Packet) -> Result<(), MediaError> {
        if self.stream_info.byte_pos_can_update {
            self.stream_info.byte_pos = packet.position();
        }

        let mut decoded = subtitle::Subtitle::new();
        let got = self.inner.decode(packet, &mut decoded)
            .or_else(|e| match e {
                ffmpeg::Error::Other { errno: EAGAIN } => {
                    warn!("subtitles::Decoder::feed: EAGAIN (unexpected)");
                    Ok(false)
                },
                ffmpeg::Error::InvalidData => {
                    warn!("subtitles::Decoder::feed: met invalid data; flushing");
                    self.flush();
                    Ok(false)
                },
                e => Err(e),
            })
            .map_err(|e| MediaError::FFMpegError {
                func: "subtitles::Decoder::feed: decode".to_string(),
                line: line!(),
                e,
            })?;

        if got {
            #[allow(clippy::cast_precision_loss)]
            let pts = units::Timestamp(decoded.pts().unwrap_or(0));
            let pts_seconds = pts.to_seconds(units::DEFAULT_TIMEBASE);
            let start = units::Seconds(pts_seconds.0 + f64::from(decoded.start()) / 1000.0);
            let end = units::Seconds(pts_seconds.0 + f64::from(decoded.end()) / 1000.0);

            let rects = decoded.rects().map(|rect| match rect {
                subtitle::Rect::Ass(a) =>
                    SubtitleRect::Ass { content: a.get().to_owned() },
                subtitle::Rect::Text(t) =>
                    SubtitleRect::Text { content: t.get().to_owned() },
                _ => SubtitleRect::Unsupported,
            }).collect();

            self.entries.push_back(SubtitleEntry { start, end, rects });
        }
        Ok(())
    }

    #[allow(dead_code)]
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn get_delta(&mut self) -> VecDeque<SubtitleEntry> {
        std::mem::take(&mut self.entries)
    }
}
