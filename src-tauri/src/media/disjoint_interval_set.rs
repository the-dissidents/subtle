use std::collections::BTreeMap;

pub struct DisjointIntervalSet<T> {
    map: BTreeMap<T, T>
}

impl<T> DisjointIntervalSet<T>
where
    T: Ord + Copy
{
    pub fn new() -> Self {
        DisjointIntervalSet { map: BTreeMap::new() }
    }

    pub fn add(&mut self, mut left: T, mut right: T) {
        assert!(right >= left);
        let mut to_remove = Vec::<T>::new();
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
    pub fn contains(&self, point: T) -> bool {
        self.contains_range(point, point)
    }

    pub fn contains_range(&self, left: T, right: T) -> bool {
        let iter = self.map.range(..=right).next_back();
        if let Some((&_a, &b)) = iter {
            b >= left
        } else {
            false
        }
    }

    pub fn covers_range(&self, left: T, right: T) -> bool {
        let iter = self.map.range(..=left).next_back();
        if let Some((&_a, &b)) = iter {
            b >= right
        } else {
            false
        }
    }
}