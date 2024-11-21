extern crate ffmpeg_next as ffmpeg;

use serde::Serialize;
use std::sync::Mutex;
use tauri::ipc::Channel;
use tauri::State;

pub mod internal;
pub(crate) use internal::MediaPlayback;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "event", content = "data")]
pub enum MediaEvent<'a> {
    #[serde(rename_all = "camelCase")]
    Done,
    #[serde(rename_all = "camelCase")]
    IntensityList {
        start: i64,
        end: i64,
        data: Vec<f32>,
    },
    #[serde(rename_all = "camelCase")]
    MediaStatus {
        audio_index: i32,
        video_index: i32,
        duration: f64,
        streams: Vec<String>,
    },
    #[serde(rename_all = "camelCase")]
    AudioStatus {
        position: i64,
        length: i64,
        sample_rate: u32,
    },
    #[serde(rename_all = "camelCase")]
    Debug { message: &'a str },
    #[serde(rename_all = "camelCase")]
    RuntimeError { what: &'a str },
    #[serde(rename_all = "camelCase")]
    NoMedia {},
}

fn send(channel: &Channel<MediaEvent>, what: MediaEvent) {
    channel.send(what).expect("Error sending event");
}

macro_rules! send_error {
    ($channel:expr, $what:expr) => {
        $channel
            .send(MediaEvent::RuntimeError {
                what: format!("{} (at line {})", AsRef::<str>::as_ref(&$what), line!()).as_str(),
            })
            .expect("Error sending event")
    };
}

fn send_nomedia(channel: &Channel<MediaEvent>) {
    channel
        .send(MediaEvent::NoMedia {})
        .expect("Error sending event");
}

fn send_done(channel: &Channel<MediaEvent>) {
    channel.send(MediaEvent::Done).expect("Error sending event");
}

#[tauri::command]
pub fn media_status(state: State<Mutex<Option<MediaPlayback>>>, channel: Channel<MediaEvent>) {
    let mut ap = state.lock().unwrap();
    let playback = match (*ap).as_mut() {
        Some(x) => x,
        None => return send_nomedia(&channel),
    };
    let audio_index: i32 = match playback.audio() {
        Some(c) => c.stream_index().try_into().unwrap(),
        None => -1,
    };
    let video_index: i32 = -1;
    send(
        &channel,
        MediaEvent::MediaStatus {
            audio_index,
            video_index,
            duration: playback.duration(),
            streams: playback.describe_streams(),
        },
    );
}

#[tauri::command]
pub fn audio_status(state: State<Mutex<Option<MediaPlayback>>>, channel: Channel<MediaEvent>) {
    let mut ap = state.lock().unwrap();
    let playback = match (*ap).as_mut() {
        Some(x) => x,
        None => return send_nomedia(&channel),
    };
    let ctx = match playback.audio() {
        Some(c) => c,
        None => return send_nomedia(&channel),
    };
    send(
        &channel,
        MediaEvent::AudioStatus {
            position: ctx.position(),
            length: ctx.length(),
            sample_rate: ctx.decoder().rate(),
        },
    );
}

#[tauri::command]
pub fn close_media(state: State<Mutex<Option<MediaPlayback>>>, channel: Channel<MediaEvent>) {
    let mut ap = state.lock().unwrap();
    if ap.is_none() {
        return send_nomedia(&channel);
    }
    *ap = None;
    send_done(&channel);
}

#[tauri::command]
pub fn open_media(
    state: State<Mutex<Option<MediaPlayback>>>,
    path: &str,
    channel: Channel<MediaEvent>,
) {
    let mut ap = state.lock().unwrap();
    if let Some(_) = *ap {
        return send_error!(&channel, "Media already open");
    }

    send(&channel, MediaEvent::Debug { message: path });

    *ap = match MediaPlayback::from_file(path) {
        Ok(x) => Some(x),
        Err(e) => return send_error!(&channel, e.to_string()),
    };

    send_done(&channel);
}

#[tauri::command]
pub fn open_audio(
    state: State<Mutex<Option<MediaPlayback>>>,
    index: i32,
    channel: Channel<MediaEvent>,
) {
    let mut ap = state.lock().unwrap();
    let playback = match (*ap).as_mut() {
        Some(x) => x,
        None => return send_nomedia(&channel),
    };

    let index = if index < 0 {
        None
    } else {
        Some(index as usize)
    };
    let audio = match playback.open_audio(index) {
        Ok(_) => playback.audio().unwrap(),
        Err(e) => return send_error!(&channel, e.to_string()),
    };

    send(
        &channel,
        MediaEvent::Debug {
            message: format!(
                "opening audio {}; time_base={}:sample_rate={}:sample_fmt={}:channel_layout=0x{:x}",
                audio.stream_index(),
                audio.decoder().time_base(),
                audio.decoder().rate(),
                audio.decoder().format().name(),
                audio.decoder().channel_layout().bits()
            )
            .as_str(),
        },
    );

    send_done(&channel);
}

#[tauri::command]
pub fn seek_audio(
    state: State<Mutex<Option<MediaPlayback>>>,
    channel: Channel<MediaEvent>,
    position: i64,
) {
    let mut ap = state.lock().unwrap();
    let playback = match (*ap).as_mut() {
        Some(x) => x,
        None => return send_nomedia(&channel),
    };
    let _ = match playback.audio() {
        Some(c) => c,
        None => return send_nomedia(&channel),
    };
    if let Err(e) = playback.seek_audio(position) {
        return send_error!(&channel, e.to_string());
    };

    send_done(&channel);
}

#[tauri::command]
pub fn get_intensities(
    state: State<Mutex<Option<MediaPlayback>>>,
    channel: Channel<MediaEvent>,
    until: i64,
    step: i64,
) {
    let mut ap = state.lock().unwrap();
    let playback = match (*ap).as_mut() {
        Some(x) => x,
        None => return send_nomedia(&channel),
    };
    if playback.audio().is_none() {
        return send_nomedia(&channel);
    }

    let mut vector = Vec::<f32>::new();
    let mut counter = 0;
    let mut sum: f32 = 0.0;
    let mut start_position = -1;

    while let Ok(Some(resampled_frame)) = playback.next_audio_frame() {
        let data: &[f32] = resampled_frame.plane(0);
        for sample in data {
            sum += (*sample) * (*sample);
            counter += 1;
            if counter == step {
                vector.push(sum / step as f32);
                counter = 0;
                sum = 0.0;
            }
        }
        if start_position < 0 {
            start_position = playback.audio().unwrap().position();
        }
        if playback.audio().unwrap().position() >= until {
            break;
        }
    }

    return send(
        &channel,
        MediaEvent::IntensityList {
            start: start_position,
            end: start_position + (vector.len() as i64) * step,
            data: vector,
        },
    );
}
