use ffmpeg_sys_next;
use log::Level;
use std::ffi::{c_char, c_int, c_void, CStr};
use lazy_static::lazy_static;
use std::sync::RwLock;

unsafe extern "C" fn rust_log_callback(
    _ptr: *mut c_void,
    level: c_int,
    fmt: *const c_char,
    args: ffmpeg_sys_next::va_list,
) {
    if fmt.is_null() {
        return;
    }

    let level: log::Level = match level {
        ffmpeg_sys_next::AV_LOG_PANIC
        | ffmpeg_sys_next::AV_LOG_FATAL
        | ffmpeg_sys_next::AV_LOG_ERROR => Level::Error,
        ffmpeg_sys_next::AV_LOG_WARNING => Level::Warn,
        ffmpeg_sys_next::AV_LOG_INFO => Level::Info,
        ffmpeg_sys_next::AV_LOG_VERBOSE => Level::Debug,
        _ => {
            return;
        }
    };

    let mut buffer = [0u8; 1024];
    ffmpeg_sys_next::vsnprintf(
        buffer.as_mut_ptr() as *mut c_char,
        buffer.len() as u64,
        fmt,
        args,
    );

    let c_str = CStr::from_ptr(buffer.as_ptr() as *const c_char);
    let message = c_str.to_string_lossy();

    log::log!(target: "ffmpeg", level, "{}", message);
}

pub fn init_ffmpeg_logging() {
    unsafe {
        ffmpeg_sys_next::av_log_set_callback(Some(rust_log_callback));
    }
}

lazy_static! {
    pub static ref LOG_LEVEL: RwLock<log::LevelFilter> = RwLock::new(log::LevelFilter::Off);
}

#[tauri::command]
pub fn set_log_filter_level(u: usize) {
    let level = match u {
        0 => log::LevelFilter::Off,
        1 => log::LevelFilter::Error,
        2 => log::LevelFilter::Warn,
        3 => log::LevelFilter::Info,
        4 => log::LevelFilter::Debug,
        5 => log::LevelFilter::Trace,
        _ => {
            return;
        }
    };
    *LOG_LEVEL.write().unwrap() = level;
}