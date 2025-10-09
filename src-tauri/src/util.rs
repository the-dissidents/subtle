use num_traits::{FromPrimitive, Num, ToPrimitive};

pub struct GuessNumber<T>
where 
    T: Num + ToPrimitive + FromPrimitive
{
    baseline: Option<T>,
    guess: Option<T>,
    tolerance: f64,
}

impl<T: Num + ToPrimitive + FromPrimitive + PartialOrd + Copy> GuessNumber<T> {
    pub fn new(tolerance: f64) -> GuessNumber<T> {
        GuessNumber {
            baseline: None,
            guess: None,
            tolerance
        }
    }

    pub fn baseline(mut self, baseline: T) -> GuessNumber<T> {
        self.baseline = Some(baseline);
        self
    }

    pub fn candidate(mut self, value: T) -> GuessNumber<T> {
        if let Some(base) = self.baseline {
            let dist = 
                if value > base { value - base } 
                else { base - value };
            if dist.to_f64().unwrap() <= base.to_f64().unwrap() * self.tolerance {
                self.guess = Some(value);
            }
        } else {
            self.guess = Some(value);
        }
        self
    }

    pub fn candidate_option(self, value: Option<T>) -> GuessNumber<T> {
        if let Some(v) = value {
            self.candidate(v)
        } else { self }
    }

    #[expect(unused)]
    pub fn candidate_result<_E>(self, value: Result<T, _E>) -> GuessNumber<T> {
        if let Ok(v) = value {
            self.candidate(v)
        } else { self }
    }

    pub fn guess(self) -> Option<T> {
        self.guess.or(self.baseline)
    }
}