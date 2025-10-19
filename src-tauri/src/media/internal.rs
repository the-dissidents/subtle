extern crate ffmpeg_next as ffmpeg;

use core::fmt;

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

macro_rules! check {
    ($e:expr) => {
        $e.map_err(|e| MediaError::FFMpegError {
            func: stringify!($e).to_string(),
            line: line!(),
            e,
        })
    };
}
pub(crate) use check;

// #[cfg(test)]
// mod tests {
//     use std::time::Instant;
//     use crate::media::{accel::HardwareDecoder, internal::{frame, VideoFront, MediaPlayback}};

//     #[test]
//     fn configuration() {
//         ffmpeg::init().unwrap();
//         println!("{}", ffmpeg::util::configuration());
//     }

//     #[test]
//     fn performance() {
//         eprintln!("list of available accelerators:");
//         for t in HardwareDecoder::available_types() {
//             println!("-- {t}");
//         }

//         let path = "E:\\Rural Landscape.mp4";
//         // let path = "/Users/emf/Downloads/Rural Landscape.mp4";
//         let mut playback = MediaPlayback::from_file(path).unwrap();
//         playback.open_video(None, false).unwrap();
//         playback.open_audio(None).unwrap();
//         if let VideoFront::Player(x) = playback.video_mut().unwrap().front_mut() {
//             x.set_output_size((768, 432)).unwrap();
//         }
//         println!("reading frames");
//         let start = Instant::now();
//         let mut i = 0;
//         let mut iv = 0;
//         let mut ia = 0;
//         while i < 10000 {
//             match playback.get_next().unwrap() {
//                 Some(frame::Frame::Video(_f)) => {
//                     // if let VideoFront::Player(x) = playback.video_mut().unwrap().front_mut() {
//                     //     x.process(f).unwrap();
//                     // }
//                     iv += 1;
//                 }
//                 Some(frame::Frame::Audio(_f)) => {
//                     // if let AudioFront::Player(x) = playback.audio_mut().unwrap().front_mut() {
//                     //     x.process(f).unwrap();
//                     // }
//                     ia += 1;
//                 }
//                 None => break,
//             }
//             i += 1;
//         }
//         println!("read {i} frames ({iv} video, {ia} audio) in {}s", start.elapsed().as_secs_f32());
//     }
// }