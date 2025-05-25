extern crate ffmpeg_next as ffmpeg;

use internal::{DecodedFrame, StreamInfo};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::ipc::{self, Channel, InvokeResponseBody, Response};
use tauri::State;

mod internal;
pub(crate) use internal::MediaPlayback;

pub struct PlaybackRegistry {
    next_id: i32,
    table: HashMap<i32, MediaPlayback>,
}

impl PlaybackRegistry {
    pub fn new() -> PlaybackRegistry {
        PlaybackRegistry {
            next_id: 0,
            table: HashMap::new(),
        }
    }
}

#[derive(Clone, Serialize, Debug)]
#[serde(rename_all = "camelCase", tag = "event", content = "data")]
pub enum MediaEvent<'a> {
    #[serde(rename_all = "camelCase")]
    Done,
    #[serde(rename = "EOF")]
    EOF,
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
        streams: Vec<StreamInfo>,
    },
    #[serde(rename_all = "camelCase")]
    AudioStatus { length: i64, sample_rate: u32 },
    #[serde(rename_all = "camelCase")]
    VideoStatus {
        length: i64,
        framerate: f64,
        out_width: u32,
        out_height: u32,
        sample_aspect_ratio: f64,
        width: u32,
        height: u32,
    },
    #[serde(rename_all = "camelCase")]
    Debug { message: &'a str },
    #[serde(rename_all = "camelCase")]
    RuntimeError { what: &'a str },
    #[serde(rename_all = "camelCase")]
    Opened { id: i32 },
    #[serde(rename_all = "camelCase")]
    NoStream {},
    #[serde(rename_all = "camelCase")]
    InvalidId {},
    #[serde(rename_all = "camelCase")]
    FfmpegVersion { value: String },
}

fn send(channel: &Channel<MediaEvent>, what: MediaEvent) {
    // log::debug!("sent message: {:?}", what);
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

fn send_invalid_id(channel: &Channel<MediaEvent>) {
    channel
        .send(MediaEvent::InvalidId {})
        .expect("Error sending event");
}

fn send_done(channel: &Channel<MediaEvent>) {
    channel.send(MediaEvent::Done).expect("Error sending event");
}

#[tauri::command]
pub fn media_version(channel: Channel<MediaEvent>) {
    let c_buf = unsafe { ffmpeg::sys::av_version_info() };
    let c_str = unsafe { std::ffi::CStr::from_ptr(c_buf) };
    send(
        &channel,
        MediaEvent::FfmpegVersion {
            value: String::from(c_str.to_str().unwrap()),
        },
    );
}

#[tauri::command]
pub fn media_status(id: i32, state: State<Mutex<PlaybackRegistry>>, channel: Channel<MediaEvent>) {
    let mut ap = state.lock().unwrap();
    let playback = match ap.table.get_mut(&id) {
        Some(x) => x,
        None => return send_invalid_id(&channel),
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
pub fn audio_status(id: i32, state: State<Mutex<PlaybackRegistry>>, channel: Channel<MediaEvent>) {
    let mut ap = state.lock().unwrap();
    let playback = match ap.table.get_mut(&id) {
        Some(x) => x,
        None => return send_invalid_id(&channel),
    };
    let ctx = match playback.audio() {
        Some(c) => c,
        None => return send(&channel, MediaEvent::NoStream {}),
    };
    send(
        &channel,
        MediaEvent::AudioStatus {
            length: ctx.length(),
            sample_rate: ctx.sample_rate(),
        },
    );
}

#[tauri::command]
pub fn video_status(id: i32, state: State<Mutex<PlaybackRegistry>>, channel: Channel<MediaEvent>) {
    let mut ap = state.lock().unwrap();
    let playback = match ap.table.get_mut(&id) {
        Some(x) => x,
        None => return send_invalid_id(&channel),
    };
    let ctx = match playback.video() {
        Some(c) => c,
        None => return send(&channel, MediaEvent::NoStream {}),
    };
    let (out_width, out_height) = ctx.output_size();
    let (width, height) = ctx.original_size();
    send(
        &channel,
        MediaEvent::VideoStatus {
            length: ctx.length(),
            framerate: ctx.framerate().into(),
            sample_aspect_ratio: ctx.sample_aspect_ratio().into(),
            width,
            height,
            out_width,
            out_height,
        },
    );
}

#[tauri::command]
pub fn video_set_size(
    id: i32, width: u32, height: u32,
    state: State<Mutex<PlaybackRegistry>>,
    channel: Channel<MediaEvent>,
) {
    let mut ap = state.lock().unwrap();
    let playback = match ap.table.get_mut(&id) {
        Some(x) => x,
        None => return send_invalid_id(&channel),
    };
    let ctx = match playback.video_mut() {
        Some(c) => c,
        None => return send(&channel, MediaEvent::NoStream {}),
    };
    match ctx.set_output_size((width, height)) {
        Ok(_) => send_done(&channel),
        Err(e) => send_error!(&channel, e),
    }
}

#[tauri::command]
pub fn close_media(id: i32, state: State<Mutex<PlaybackRegistry>>, channel: Channel<MediaEvent>) {
    let mut ap = state.lock().unwrap();
    if ap.table.remove(&id).is_none() {
        return send_invalid_id(&channel);
    }
    send_done(&channel);
}

#[tauri::command]
pub fn open_media(state: State<Mutex<PlaybackRegistry>>, path: &str, channel: Channel<MediaEvent>) {
    let mut ap = state.lock().unwrap();
    send(&channel, MediaEvent::Debug { message: path });

    let playback = match MediaPlayback::from_file(path) {
        Ok(x) => x,
        Err(e) => return send_error!(&channel, e.to_string()),
    };

    let id = ap.next_id;
    ap.next_id += 1;
    ap.table.insert(id, playback);
    send(&channel, MediaEvent::Opened { id });
}

#[tauri::command]
pub fn open_video(
    id: i32,
    video_id: i32,
    state: State<Mutex<PlaybackRegistry>>,
    channel: Channel<MediaEvent>,
) {
    let mut ap = state.lock().unwrap();
    let playback = match ap.table.get_mut(&id) {
        Some(x) => x,
        None => return send_invalid_id(&channel),
    };

    let index = if video_id < 0 {
        None
    } else {
        Some(video_id as usize)
    };
    let video = match playback.open_video(index) {
        Ok(_) => playback.video().unwrap(),
        Err(e) => return send_error!(&channel, e.to_string()),
    };

    send(
        &channel,
        MediaEvent::Debug {
            message: format!(
                "opening video {}; len={}:format={}",
                video.stream_index(),
                video.length(),
                video.pixel_format().descriptor().unwrap().name()
            )
            .as_str(),
        },
    );

    send_done(&channel);
}

#[tauri::command]
pub fn open_audio(
    id: i32,
    audio_id: i32,
    state: State<Mutex<PlaybackRegistry>>,
    channel: Channel<MediaEvent>,
) {
    let mut ap = state.lock().unwrap();
    let playback = match ap.table.get_mut(&id) {
        Some(x) => x,
        None => return send_invalid_id(&channel),
    };

    let index = if audio_id < 0 {
        None
    } else {
        Some(audio_id as usize)
    };
    match playback.open_audio(index) {
        Ok(_) => playback.audio().unwrap(),
        Err(e) => return send_error!(&channel, e.to_string()),
    };

    send_done(&channel);
}

#[tauri::command]
pub fn seek_audio(
    id: i32,
    position: i64,
    state: State<Mutex<PlaybackRegistry>>,
    channel: Channel<MediaEvent>,
) {
    let mut ap = state.lock().unwrap();
    let playback = match ap.table.get_mut(&id) {
        Some(x) => x,
        None => return send_invalid_id(&channel),
    };
    if playback.audio().is_none() {
        return send(&channel, MediaEvent::NoStream {});
    };
    if let Err(e) = playback.seek_audio(position) {
        return send_error!(&channel, e.to_string());
    };
    send_done(&channel);
}

#[tauri::command]
pub fn seek_video(
    id: i32,
    position: i64,
    state: State<Mutex<PlaybackRegistry>>,
    channel: Channel<MediaEvent>,
) {
    let mut ap = state.lock().unwrap();
    let playback = match ap.table.get_mut(&id) {
        Some(x) => x,
        None => return send_invalid_id(&channel),
    };
    if playback.video().is_none() {
        return send(&channel, MediaEvent::NoStream {});
    };
    if let Err(e) = playback.seek_video(position) {
        return send_error!(&channel, e.to_string());
    };
    send_done(&channel);
}

#[tauri::command]
pub fn seek_precise_and_get_frame(
    id: i32,
    position: i64,
    state: State<Mutex<PlaybackRegistry>>,
    channel: Channel<MediaEvent>,
) -> Result<ipc::Response, ()> {
    let mut ap = state.lock().unwrap();
    let playback = match ap.table.get_mut(&id) {
        Some(x) => x,
        None => {
            send_invalid_id(&channel);
            return Err(());
        }
    };
    if playback.video().is_none() {
        send(&channel, MediaEvent::NoStream {});
        return Err(());
    };
    match playback.seek_precise(position) {
        Ok(Some(DecodedFrame::Video(f))) => return send_video_frame(f),
        Ok(Some(DecodedFrame::Audio(f))) => return send_audio_frame(f),
        Ok(None) => send(&channel, MediaEvent::EOF),
        Err(e) => send_error!(&channel, e.to_string()),
    };
    Ok(Response::new(InvokeResponseBody::Raw(vec![])))
}

#[tauri::command]
pub fn get_next_frame_data(
    id: i32,
    state: State<Mutex<PlaybackRegistry>>,
    channel: Channel<MediaEvent>,
) -> Result<ipc::Response, ()> {
    let mut ap = state.lock().unwrap();
    let playback = match ap.table.get_mut(&id) {
        Some(x) => x,
        None => {
            send_invalid_id(&channel);
            return Err(());
        }
    };

    match playback.get_next() {
        Ok(Some(DecodedFrame::Video(f))) => return send_video_frame(f),
        Ok(Some(DecodedFrame::Audio(f))) => return send_audio_frame(f),
        Ok(None) => {
            send(&channel, MediaEvent::EOF);
        }
        Err(e) => {
            send_error!(&channel, e.to_string());
        }
    };
    Ok(Response::new(InvokeResponseBody::Raw(vec![])))
}

/**
 * returns: [
 *  type        : [u32] = 1
 *  position    : [i32]
 *  time        : [f64]
 *  stride      : [u32]
 *  length      : [u32]
 *  rgba_data   : \[[u8]]
 * ]
 * */
pub fn send_video_frame(frame: internal::DecodedVideoFrame) -> Result<ipc::Response, ()> {
    fn to_byte_slice<'a>(data: &'a [(u8, u8, u8, u8)]) -> &'a [u8] {
        unsafe { std::slice::from_raw_parts(data.as_ptr() as *const _, data.len() * 4) }
    }

    let pos = frame.position;
    let time = frame.time;
    let data = to_byte_slice(frame.decoded.plane(0));

    let mut binary = Vec::<u8>::new();
    binary.extend((1 as u32).to_le_bytes().iter());
    binary.extend((pos as i32).to_le_bytes().iter());
    binary.extend(time.to_le_bytes().iter());
    binary.extend(((frame.decoded.stride(0) / 4) as u32).to_le_bytes().iter());
    binary.extend((data.len() as u32).to_le_bytes().iter());
    binary.extend_from_slice(data);

    Ok(Response::new(InvokeResponseBody::Raw(binary)))
}

/**
 * returns: [
 *  type        : [u32] = 0
 *  position    : [i32]
 *  time        : [f64]
 *  length      : [u32]
 *  sample_data : [f32]
 * ]
 * */
pub fn send_audio_frame(frame: internal::DecodedAudioFrame) -> Result<ipc::Response, ()> {
    // FIXME: support multiple channels
    fn to_byte_slice<'a>(floats: &'a [f32]) -> &'a [u8] {
        unsafe { std::slice::from_raw_parts(floats.as_ptr() as *const _, floats.len() * 4) }
    }

    let pos = frame.position;
    let time = frame.time;
    let data: &[f32] = frame.decoded.plane(0);

    let mut binary = Vec::<u8>::new();
    binary.extend((0 as u32).to_le_bytes().iter());
    binary.extend((pos as i32).to_le_bytes().iter());
    binary.extend(time.to_le_bytes().iter());
    binary.extend((data.len() as u32).to_le_bytes().iter());
    binary.extend_from_slice(&to_byte_slice(data));

    Ok(Response::new(InvokeResponseBody::Raw(binary)))
}

#[tauri::command]
pub fn get_intensities(
    id: i32,
    until: i64,
    step: i64,
    state: State<Mutex<PlaybackRegistry>>,
    channel: Channel<MediaEvent>,
) {
    let mut ap = state.lock().unwrap();
    let playback = match ap.table.get_mut(&id) {
        Some(x) => x,
        None => return send_invalid_id(&channel),
    };
    if playback.audio().is_none() {
        return send(&channel, MediaEvent::NoStream {});
    }

    let mut vector = Vec::<f32>::new();
    let mut counter = 0;
    let mut sum: f32 = 0.0;
    let mut start_position = -1;

    loop {
        let frame = match playback.get_next() {
            Ok(Some(DecodedFrame::Audio(f))) => f,
            Ok(Some(_)) => continue,
            Ok(None) => break,
            Err(e) => return send_error!(&channel, format!("get_intensities: get_next(): {e}")),
        };

        let data: &[f32] = frame.decoded.plane(0);
        for sample in data {
            sum = sum.max(sample.abs());
            counter += 1;
            if counter == step {
                vector.push(sum);
                counter = 0;
                sum = 0.0;
            }
        }
        if start_position < 0 {
            start_position = frame.position;
        }
        if frame.position >= until {
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
