use std::{collections::VecDeque, slice};

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
    // Note: SRT decodes into ASS in ffmpeg
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

    header: Option<String>,
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

        // ffmpeg_next doesn't yet export subtitle_header
        let header = unsafe {
            let ctx = decoder.as_ptr();
            if (*ctx).subtitle_header.is_null() {
                None
            } else {
                #[allow(clippy::cast_sign_loss)]
                Some(String::from_utf8_lossy(slice::from_raw_parts(
                    (*ctx).subtitle_header,
                    (*ctx).subtitle_header_size as usize)
                ).to_string())
            }
        };

        Ok(Decoder { inner: decoder, stream_info, entries: VecDeque::new(), header })
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
        let got = check!(self.inner.decode(packet, &mut decoded)
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
            }))?;

        if !got { return Ok(()); }

        // subtitle decoders often don't write to start_display_time and end_display_time
        // we need to look into packet data

        let (pts, base) =
            decoded.pts().map(|pts| (pts, units::DEFAULT_TIMEBASE))
            .or(packet.pts().map(|pts| (pts, self.stream_info.timebase())))
            .unwrap_or((0, units::DEFAULT_TIMEBASE));

        let units::Seconds(pts_seconds) =
            units::Timestamp(pts).to_seconds(base);
        let units::Seconds(duration_seconds) =
            units::Timestamp(packet.duration()).to_seconds(self.stream_info.timebase());

        let (start, end) = if decoded.start() > 0 || decoded.end() > 0 { (
            units::Seconds(pts_seconds + f64::from(decoded.start()) / 1000.0),
            units::Seconds(pts_seconds + f64::from(decoded.end()) / 1000.0)
        ) } else { (
            units::Seconds(pts_seconds),
            units::Seconds(pts_seconds + duration_seconds)
        ) };

        let rects = decoded.rects().map(|rect| match rect {
            subtitle::Rect::Ass(a) =>
                SubtitleRect::Ass { content: a.get().to_owned() },
            subtitle::Rect::Text(t) =>
                SubtitleRect::Text { content: t.get().to_owned() },
            _ => SubtitleRect::Unsupported,
        }).collect();

        self.entries.push_back(SubtitleEntry { start, end, rects });
        Ok(())
    }

    pub fn header(&self) -> Option<String> {
        self.header.clone()
    }

    #[allow(dead_code)]
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn get_delta(&mut self) -> VecDeque<SubtitleEntry> {
        std::mem::take(&mut self.entries)
    }
}
