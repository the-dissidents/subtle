use std::collections::BTreeMap;
use ordered_float::OrderedFloat;

type Of64 = OrderedFloat<f64>;

pub struct DisjointIntervalSet {
    map: BTreeMap<Of64, Of64>
}

impl DisjointIntervalSet {
    pub fn new() -> Self {
        DisjointIntervalSet { map: BTreeMap::new() }
    }

    pub fn add(&mut self, left: f64, right: f64) {
        assert!(right >= left);
        
        let mut left = OrderedFloat(left);
        let mut right = OrderedFloat(right);
        let mut to_remove = Vec::<Of64>::new();
        {
            let mut iter = self.map.range(..=right);
            while let Some((&a, &b)) = iter.next_back() {
                if b >= left {
                    left = left.min(a);
                    right = right.max(b);
                    to_remove.push(a);
                } else {
                    break;
                }
            }
        }

        for a in to_remove {
            self.map.remove(&a);
        }
        self.map.insert(left, right);
    }

    #[expect(unused)]
    pub fn contains(&self, point: f64) -> bool {
        self.contains_range(point, point)
    }

    pub fn contains_range(&self, left: f64, right: f64) -> bool {
        let left = OrderedFloat(left);
        let right = OrderedFloat(right);

        let iter = self.map.range(..=right).next_back();
        if let Some((&_a, &b)) = iter {
            b >= left
        } else {
            false
        }
    }

    pub fn covers_range(&self, left: f64, right: f64) -> bool {
        let left = OrderedFloat(left);
        let right = OrderedFloat(right);

        let iter = self.map.range(..=left).next_back();
        if let Some((&_a, &b)) = iter {
            b >= right
        } else {
            false
        }
    }
}