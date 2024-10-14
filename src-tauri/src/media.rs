extern crate ffmpeg_next as ffmpeg;

use std::cell::{Ref, RefCell};
use std::sync::{LazyLock, Mutex};

use ffmpeg::{codec, filter, format, frame, media};
use ffmpeg::{rescale, Rescale};

use ffmpeg_next::Stream;
use tauri::State;
use tauri::{AppHandle, ipc::Channel};
use serde::Serialize;

enum AudioContextStatus {
    AwaitingStreamChoice,
    Ready
}

struct AudioContext<'a> {
    input: Box<format::context::Input>,
    stream: Box<Stream<'a>>,
    status: AudioContextStatus
}

struct AudioPlayback<'a> {
    current: Option<AudioContext<'a>>
}

unsafe impl<'a> Send for AudioPlayback<'a> {}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "event", content = "data")]
enum MediaEvent<'a> {
    #[serde(rename_all = "camelCase")]
    Ready {
    },
    #[serde(rename_all = "camelCase")]
    OpenError {
        what: &'a str
    }
}

#[tauri::command]
fn open_media(
        playback: State<Mutex<AudioPlayback<'_>>>, 
        path: &str, 
        channel: Channel<MediaEvent>) 
{
    let ref mut ap 
        = playback.lock().unwrap();
    if ap.current.is_some() {
        channel.send(MediaEvent::OpenError { what: "Already opened" })
            .expect("Error sending event");
        return;
    }

    let ictx = match format::input(&path) {
        Ok(i) => i,
        Err(e) => {
            channel.send(MediaEvent::OpenError { what: e.to_string().as_str() })
                .expect("Error sending event");
            return;
        }
    };
    match ictx.streams().best(media::Type::Audio) {
        Some(best) => {
            ap.current = Some(AudioContext {
                input: Box::new(ictx),
                stream: Box::new(best),
                status: AudioContextStatus::Ready
            });
            channel.send(MediaEvent::Ready {  })
                .expect("Error sending event")
        },
        None => {
            channel.send(MediaEvent::OpenError { what: "No sound streams" })
                .expect("Error sending event")
        }
    }
}

// fn get_frame() {
//     let status = CURRENT_STATUS.lock().unwrap();
//     match status {
//         MediaPlaybackStatus::Ready { ictx, current_audio } => {
//             for (stream, mut packet) in ictx.packets() {
//                 if (stream.index() == current_audio.index()) {
//                     // send to decoder

//                     // get decoded frame
//                 }
//             }
//         }
//         _ => {
//             return Err("get_frame called when not ready");
//         }
//     }
// }

// fn test(ictx: &mut format::context::Input) {
    

//     let input = ictx
//         .streams()
//         .best(media::Type::Audio)
//         .expect("could not find best audio stream");
//     let context = ffmpeg::codec::context::Context::from_parameters(input.parameters())?;
//     let mut decoder = context.decoder().audio()?;
//     ictx.packets()
// }

// fn get_intensities(ictx: &mut format::context::Input, from: i64, to: i64) {
    
// }