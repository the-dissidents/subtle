use std::fmt::Display;

pub use ffmpeg_next::Rational;
pub use ffmpeg_next::rescale::TIME_BASE as DEFAULT_TIMEBASE;
use num_traits::ToPrimitive;

#[derive(Copy, Clone, Debug, PartialEq, PartialOrd, serde::Serialize, serde::Deserialize, ts_rs::TS)]
pub struct Seconds(pub f64);

impl Display for Seconds {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:.3}s", self.0)
    }
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct Timestamp(pub i64);

impl Timestamp {
    pub fn to_seconds(self, timebase: Rational) -> Seconds {
        Seconds(f64::from(timebase) * self.0.to_f64().unwrap())
    }

    pub fn from_seconds(s: Seconds, timebase: Rational) -> Timestamp {
        Timestamp((s.0 / f64::from(timebase)).to_i64().unwrap())
    }
}