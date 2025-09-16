use log::Level;
use std::ffi::{c_char, c_int, c_void};
use lazy_static::lazy_static;
use std::sync::RwLock;

// cf. https://github.com/rust-lang/rust-bindgen/issues/2631

#[cfg(any(
    // Use ffmpeg_sys_next::va_list on macOS/aarch64 and Windows/MSVC.
    all(target_os = "macos", target_arch = "aarch64"),
    all(target_os = "windows", target_env = "msvc")
))]
type VaList = ffmpeg_sys_next::va_list;

#[cfg(not(any(
    all(target_os = "macos", target_arch = "aarch64"),
    all(target_os = "windows", target_env = "msvc")
)))]
type VaList = *mut ffmpeg_sys_next::__va_list_tag;

unsafe extern "C" fn rust_log_callback(
    _ptr: *mut c_void,
    level: c_int,
    fmt: *const c_char,
    args: VaList,
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

    let str = vsprintf::vsprintf(fmt, args).unwrap();
    log::log!(target: "ffmpeg", level, "{}", str.trim_end());
}

pub fn init_ffmpeg_logging() {
    unsafe {
        ffmpeg_sys_next::av_log_set_callback(Some(rust_log_callback));
    }
}

lazy_static! {
    pub static ref LOG_LEVEL: RwLock<log::LevelFilter> = RwLock::new(log::LevelFilter::Trace);
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