/// A tree structure for efficient aggregation of values over ranges.
#[derive(Debug)]
pub struct AggregationTree<N, F>
where
    N: Copy,
    F: Fn(N, N) -> N,
{
    /// The flattened tree data. `None` represents an uninitialized or empty node.
    data: Vec<N>,
    /// The total number of layers in the tree.
    layers: u32,
    /// The index in `data` where the leaf nodes begin.
    leaf_start: usize,
    /// The number of leaf nodes, representing the conceptual length of the data array.
    pub length: usize,
    /// The associative operation used to aggregate values from child nodes.
    /// This is a zero-sized type in memory if the closure captures no state.
    pub aggregator: F,
}

impl<N, F> AggregationTree<N, F>
where
    N: Copy,
    F: Fn(N, N) -> N,
{
    /// Creates a new `AggregationTree`.
    ///
    /// # Arguments
    ///
    /// * `length`: The number of data points (leaf nodes) in the tree. Must be greater than 1.
    /// * `aggregator`: An associative closure that combines two values. For example, `|a, b| a + b` for summation.
    /// * `initial`: The initial value for all nodes in the tree. Use `None` to represent empty nodes.
    ///
    /// # Panics
    ///
    /// Panics if `length` is not greater than 1.
    pub fn new(length: usize, aggregator: F, initial: N) -> Self {
        assert!(length > 1, "Length must be greater than 1");

        let layers = (length as f64).log2().ceil() as u32 + 1;
        let leaf_start = 2usize.pow(layers - 1) - 1;
        let total_size = leaf_start + length;
        let data = vec![initial; total_size];

        Self {
            data,
            layers,
            leaf_start,
            length,
            aggregator,
        }
    }

    /// Updates a range of leaf values starting at a given index.
    ///
    /// # Arguments
    ///
    /// * `values`: A slice of values to set.
    /// * `start`: The starting leaf index to update.
    pub fn set(&mut self, values: &[N], start: usize) {
        if values.is_empty() {
            return;
        }

        let first_leaf_idx = self.leaf_start + start;
        let last_leaf_idx = first_leaf_idx + values.len() - 1;
        debug_assert!(last_leaf_idx < self.data.len(), "Update range is out of bounds");

        for (i, &value) in values.iter().enumerate() {
            self.data[first_leaf_idx + i] = value;
        }

        self.propagate_up(first_leaf_idx, last_leaf_idx);
    }

    pub fn at(&self, index: usize) -> N {
        let idx = self.leaf_start + index;
        debug_assert!(idx < self.data.len(), "Index is out of bounds");
        self.data[idx]
    }

    // /// Fills a range of leaf nodes with a single value.
    // ///
    // /// # Arguments
    // ///
    // /// * `value`: The value to fill the range with.
    // /// * `start`: The starting leaf index (inclusive).
    // /// * `end`: The ending leaf index (exclusive).
    // pub fn fill(&mut self, value: N, start: usize, end: usize) {
    //     assert!(end >= start, "End index must be greater than or equal to start index");
    //     if start == end {
    //         return;
    //     }

    //     let first_leaf_idx = self.leaf_start + start;
    //     let last_leaf_idx_exclusive = self.leaf_start + end;
    //     debug_assert!(last_leaf_idx_exclusive <= self.data.len(), "Fill range is out of bounds");

    //     for i in first_leaf_idx..last_leaf_idx_exclusive {
    //         self.data[i] = value;
    //     }

    //     self.propagate_up(first_leaf_idx, last_leaf_idx_exclusive - 1);
    // }

    pub fn get_leaf_level(&self) -> &[N] {
        &self.data[self.leaf_start..]
    }

    /// Retrieves a slice representing a single level of the tree.
    pub fn get_level(&self, resolution: usize) -> &[N] {
        debug_assert!(resolution.is_power_of_two(), "Resolution must be a power of 2");
        debug_assert!(resolution <= self.length, "Resolution cannot be greater than length");

        let level = resolution.ilog2();
        let layer = self.layers - level;

        let start_idx = 2usize.pow(layer - 1) - 1;
        let end_idx = (2usize.pow(layer) - 1).min(self.data.len() - 1);

        &self.data[start_idx..end_idx]
    }

    /// Propagates changes from a range of updated nodes up to the root.
    fn propagate_up(&mut self, first_idx: usize, last_idx: usize) {
        let mut first = self.parent(first_idx);
        let mut last = self.parent(last_idx);

        while let (Some(f), Some(l)) = (first, last) {
            for i in f..=l {
                self.aggregate_node(i);
            }
            if f == 0 {
                break;
            }
            first = self.parent(f);
            last = self.parent(l);
        }
    }

    /// Calculates the index of a node's parent.
    fn parent(&self, index: usize) -> Option<usize> {
        if index == 0 {
            None
        } else {
            Some((index - 1) / 2)
        }
    }

    /// Re-calculates the value of a single node based on its children's values.
    fn aggregate_node(&mut self, index: usize) {
        debug_assert!(index < self.leaf_start, "Cannot aggregate a leaf node");
        let left_child_idx = index * 2 + 1;
        let right_child_idx = index * 2 + 2;

        let l = self.data[left_child_idx];
        let r = self.data[right_child_idx];
        self.data[index] = (self.aggregator)(l, r);
    }
}