pub use ffmpeg_next::frame::{Audio as AudioData, Video as VideoData};

use crate::media::units;

pub enum Frame {
    Audio(Audio),
    Video(Video)
}

pub struct FrameMetadata {
    pub byte_pos: isize,
    pub pkt_pos: i64,
    pub time: units::Seconds,
}

pub struct Audio {
    pub meta: FrameMetadata,
    pub decoded: AudioData,
}

pub struct Video {
    pub meta: FrameMetadata,
    pub decoded: VideoData,
}

impl From<Audio> for Frame {
    fn from(value: Audio) -> Self {
        Frame::Audio(value)
    }
}

impl From<Video> for Frame {
    fn from(value: Video) -> Self {
        Frame::Video(value)
    }
}

impl Frame {
    #[expect(unused)]
    pub fn meta(&self) -> &FrameMetadata {
        match self {
            Frame::Audio(f) => &f.meta,
            Frame::Video(f) => &f.meta,
        }
    }
}