#![allow(clippy::float_cmp)]

use std::time::{Duration, Instant};

use num_traits::ToPrimitive;
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;

#[derive(Debug, Copy, Clone, PartialEq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum MatchType {
    Match,
    Substitute,
    Delete,
    Insert,
}

#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SolutionToken {
    pub match_type: MatchType,
    pub i: Option<usize>,
    pub j: Option<usize>,
}

#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MatchResult {
    pub score: f32,
    pub tokens: Vec<SolutionToken>,
}

pub trait FuzzyConfig<T> {
    fn insert(&self, _val: &T, _i: usize, _j: usize) -> f32 { 1.0 }
    fn delete(&self, _val: &T, _i: usize, _j: usize) -> f32 { 1.0 }
    fn substitute(&self, _a: &T, _b: &T, _i: usize, _j: usize) -> f32 { 1.0 }
    fn report(&self, _progress: usize, _total: usize) {}
}

pub fn fuzzy_match<T, S>(
    a: &[T],
    z: &[T],
    config: &S,
    whole_sequence: bool,
) -> Option<MatchResult>
where
    T: PartialEq,
    S: FuzzyConfig<T> + ?Sized,
{
    let m = a.len();
    let n = z.len();
    let cols = n + 1;

    // 1D vectors for cache-friendly memory layout
    let mut dp_op = vec![MatchType::Match; (m + 1) * cols];
    let mut dp_score = vec![f32::INFINITY; (m + 1) * cols];

    // Inline closure for 2D to 1D index mapping
    let idx = |i: usize, j: usize| i * cols + j;

    dp_op[idx(0, 0)] = MatchType::Match;
    dp_score[idx(0, 0)] = 0.0;

    for i in 1..=m {
        dp_op[idx(i, 0)] = MatchType::Delete;
        dp_score[idx(i, 0)] =
            dp_score[idx(i - 1, 0)] + config.delete(&a[i - 1], i, 0);
    }

    for j in 1..=n {
        if whole_sequence {
            dp_op[idx(0, j)] = MatchType::Insert;
            dp_score[idx(0, j)] =
                dp_score[idx(0, j - 1)] + config.insert(&z[j - 1], 0, j);
        } else {
            dp_op[idx(0, j)] = MatchType::Match;
            dp_score[idx(0, j)] = 0.0;
        }
    }

    let mut start = Instant::now();
    // Core DP logic
    for i in 1..=m {
        for j in 1..=n {
            let ai = &a[i - 1];
            let zj = &z[j - 1];

            if ai == zj {
                dp_op[idx(i, j)] = MatchType::Match;
                dp_score[idx(i, j)] = dp_score[idx(i - 1, j - 1)];
            } else {
                let si = dp_score[idx(i, j-1)] + config.insert(zj, i, j);
                let sd = dp_score[idx(i-1, j)] + config.delete(ai, i, j);
                let ss = dp_score[idx(i-1, j-1)] + config.substitute(ai, zj, i, j);

                let minimum = si.min(sd).min(ss);
                dp_score[idx(i, j)] = minimum;

                dp_op[idx(i, j)] = if minimum == si {
                    MatchType::Insert
                } else if minimum == sd {
                    MatchType::Delete
                } else {
                    MatchType::Substitute
                };
            }
        }
        if start.elapsed() > Duration::from_millis(100) {
            config.report(i, m);
            start = Instant::now();
        }
    }

    let mut current_i = m;
    let mut current_j = n;
    let mut best_score = f32::INFINITY;

    if whole_sequence {
        best_score = dp_score[idx(m, n)];
    } else {
        for j in 0..=n {
            let score = dp_score[idx(m, j)];
            if score < best_score {
                current_j = j;
                best_score = score;
            }
        }
        if current_j == 0 {
            return None;
        }
    }

    // Pre-allocate capacity roughly equal to the longest path
    let mut tokens = Vec::with_capacity(m.max(n));

    while current_i > 0 || (whole_sequence && current_j > 0) {
        let op = dp_op[idx(current_i, current_j)];

        // checked_sub returns None if 0 - 1 is attempted
        let i_idx = current_i.checked_sub(1);
        let j_idx = current_j.checked_sub(1);

        tokens.push(SolutionToken {
            match_type: op,
            i: i_idx,
            j: j_idx,
        });

        match op {
            MatchType::Substitute | MatchType::Match => {
                current_i -= 1;
                current_j -= 1;
            }
            MatchType::Insert => current_j -= 1,
            MatchType::Delete => current_i -= 1,
        }
    }

    tokens.reverse();

    Some(MatchResult {
        score: best_score,
        tokens,
    })
}


#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DiffEntry {
    idx: usize,
    start: f64,
    end: f64,
    text: String
}

impl PartialEq for DiffEntry {
    fn eq(&self, other: &Self) -> bool {
           (self.start - other.start).abs() < 0.0001
        && (self.end - other.end).abs() < 0.0001
        && self.text == other.text
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct EntryScorer {
    text_weight: f32,
    time_weight: f32,
    use_levenshtein: bool
}

struct DiffConfig {
    channel: Channel<(usize, usize)>,
    scorer: EntryScorer
}

impl FuzzyConfig<DiffEntry> for DiffConfig {
    fn substitute(&self, a: &DiffEntry, b: &DiffEntry, _i: usize, _j: usize) -> f32 {
        let time = if (a.start - b.start).abs() < 0.01 && (a.end - b.end).abs() < 0.01
            { 0.0 } else { self.scorer.time_weight };
        let text = if a.text == b.text || self.scorer.text_weight == 0.0 { 0.0 }
            else if self.scorer.use_levenshtein {
                rapidfuzz::distance::levenshtein::normalized_distance(
                    a.text.chars(), b.text.chars()).to_f32().unwrap() * self.scorer.text_weight
            } else { self.scorer.text_weight };
        time + text
    }

    fn report(&self, progress: usize, total: usize) {
        self.channel.send((progress, total)).unwrap();
    }
}

#[tauri::command(async)]
pub fn diff_entries(
    channel: Channel<(usize, usize)>,
    a: Vec<DiffEntry>, b: Vec<DiffEntry>, scorer: EntryScorer,
) -> Option<MatchResult> {
    fuzzy_match(&a, &b, &DiffConfig { channel, scorer }, true)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Helper to easily create slices for testing
    fn to_chars(s: &str) -> Vec<char> {
        s.chars().collect()
    }

    pub struct DefaultScorer;
    impl<T> FuzzyConfig<T> for DefaultScorer {}

    #[test]
    fn test_exact_match() {
        let a = to_chars("hello");
        let z = to_chars("hello");
        let scorer = DefaultScorer;

        let result = fuzzy_match(&a, &z, &scorer, true).expect("Match failed");

        assert_eq!(result.score, 0.0);
        assert_eq!(result.tokens.len(), 5);
        assert!(result.tokens.iter().all(|t| t.match_type == MatchType::Match));
    }

    #[test]
    fn test_sub_sequence_match() {
        let a = to_chars("test");
        let z = to_chars("pre_test_post");
        let scorer = DefaultScorer;

        // Sub-sequence should skip the prefix and suffix without penalty
        let result = fuzzy_match(&a, &z, &scorer, false).unwrap();

        assert_eq!(result.score, 0.0);
        assert_eq!(result.tokens.len(), 4);

        // Ensure the match in Z started at index 4 (the 't' in "pre_test")
        assert_eq!(result.tokens[0].j, Some(4));
    }

    #[test]
    fn test_whole_sequence_match_penalizes_unmatched_edges() {
        let a = to_chars("test");
        let z = to_chars("pre_test");
        let scorer = DefaultScorer;

        // Whole-sequence must penalize the leading "pre_"
        let result = fuzzy_match(&a, &z, &scorer, true).unwrap();

        assert_eq!(result.score, 4.0); // 4 default insertions
        assert_eq!(result.tokens.len(), 8); // 4 inserts + 4 matches

        // The first 4 operations should be inserts to align the prefix
        for t in result.tokens.iter().take(4) {
            assert_eq!(t.match_type, MatchType::Insert);
        }
    }

    // Custom Scorer that heavily penalizes substitutions
    struct AsymmetricScorer;
    impl FuzzyConfig<char> for AsymmetricScorer {
        fn substitute(&self, _a: &char, _b: &char, _i: usize, _j: usize) -> f32 {
            10.0
        }
        fn delete(&self, _val: &char, _i: usize, _j: usize) -> f32 {
            5.0
        }
        fn insert(&self, _val: &char, _i: usize, _j: usize) -> f32 {
            1.0
        }
    }

    #[test]
    fn test_custom_scorer_pathing() {
        let a = to_chars("cat");
        let z = to_chars("bat");
        let scorer = AsymmetricScorer;

        let result = fuzzy_match(&a, &z, &scorer, true).unwrap();

        // A substitution costs 10.
        // A deletion (5) + insertion (1) costs 6.
        // The algorithm should choose the cheaper path of deleting 'c' and inserting 'b'.
        assert_eq!(result.score, 6.0);
        assert_eq!(result.tokens[0].match_type, MatchType::Delete); // Delete 'c'
        assert_eq!(result.tokens[1].match_type, MatchType::Insert); // Insert 'b'
        assert_eq!(result.tokens[2].match_type, MatchType::Match);  // Match 'a'
        assert_eq!(result.tokens[3].match_type, MatchType::Match);  // Match 't'
    }

    #[test]
    fn test_no_match_possible() {
        let a = to_chars("a");
        let z: Vec<char> = vec![];
        let scorer = DefaultScorer;

        // Cannot find a subsequence "a" inside an empty sequence
        let result = fuzzy_match(&a, &z, &scorer, false);
        assert!(result.is_none());
    }
}
