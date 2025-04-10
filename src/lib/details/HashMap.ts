// Written by o3-mini

/**
 * A HashMap that supports custom hash and equality functions.
 */
export class HashMap<T, V> extends Map<T, V> {
	// Internal buckets keyed by hash values.
	private _buckets: Map<string, Array<{ key: T; value: V }>>;

	// Hash function: Should return a string hash for the given key.
	private _hashFunc: (key: T) => string;

	// Equality function to compare two keys.
	private _equalFunc: (a: T, b: T) => boolean;

	/**
	 * Creates a new HashMap.
	 *
	 * @param hashFunc - Optional. A function that returns a string hash for a key.
	 *                   Default is to use JSON.stringify.
	 * @param equalFunc - Optional. A function to compare two keys.
	 *                    Default is to use equality of hashes.
	 * @param entries - Optional. An iterable of key-value pairs to initialize the map.
	 */
	constructor(
		hashFunc?: (key: T) => string,
		equalFunc?: (a: T, b: T) => boolean,
		entries?: Iterable<[T, V]>
	) {
		super();
		this._hashFunc = hashFunc || ((key: T) => JSON.stringify(key));
		this._equalFunc = equalFunc || ((a: T, b: T) => this._hashFunc(a) === this._hashFunc(b));
		this._buckets = new Map();

		if (entries) {
			for (const [key, value] of entries) {
				this.set(key, value);
			}
		}
	}

    static build<T>(
		hashFunc?: (key: T) => string,
		equalFunc?: (a: T, b: T) => boolean
    ): new<V>(entries?: Iterable<[T, V]>) => HashMap<T, V> {
        return class<V> extends HashMap<T, V> {
            constructor(entries?: Iterable<[T, V]>) {
                super(hashFunc, equalFunc, entries);
            }
        }
    }

	/**
	 * Returns the number of key/value pairs in the HashMap.
	 */
	get size(): number {
		let count = 0;
		for (const bucket of this._buckets.values()) {
			count += bucket.length;
		}
		return count;
	}

	/**
	 * Returns the value associated with the key, or undefined if not found.
	 */
	override get(key: T): V | undefined {
		const hash = this._hashFunc(key);
		const bucket = this._buckets.get(hash);
		if (!bucket) return undefined;
		for (const entry of bucket) {
			if (this._equalFunc(entry.key, key)) {
				return entry.value;
			}
		}
		return undefined;
	}

	/**
	 * Sets the value for the key in the HashMap.
	 *
	 * If the key already exists (as determined by the equality function),
	 * its value will be updated.
	 */
	override set(key: T, value: V): this {
		const hash = this._hashFunc(key);
		let bucket = this._buckets.get(hash);
		if (!bucket) {
			bucket = [];
			this._buckets.set(hash, bucket);
		}
		for (const entry of bucket) {
			if (this._equalFunc(entry.key, key)) {
				entry.value = value;
				return this;
			}
		}
		bucket.push({ key, value });
		return this;
	}

	/**
	 * Returns true if the key exists in the HashMap, false otherwise.
	 */
	override has(key: T): boolean {
		const hash = this._hashFunc(key);
		const bucket = this._buckets.get(hash);
		if (!bucket) return false;
		return bucket.some((entry) => this._equalFunc(entry.key, key));
	}

	/**
	 * Removes the key and its associated value from the HashMap.
	 * Returns true if the key was found and removed, false otherwise.
	 */
	override delete(key: T): boolean {
		const hash = this._hashFunc(key);
		const bucket = this._buckets.get(hash);
		if (!bucket) return false;
		const index = bucket.findIndex((entry) => this._equalFunc(entry.key, key));
		if (index >= 0) {
			bucket.splice(index, 1);
			if (bucket.length === 0) {
				this._buckets.delete(hash);
			}
			return true;
		}
		return false;
	}

	/**
	 * Removes all key/value pairs from the HashMap.
	 */
	override clear(): void {
		this._buckets.clear();
	}

	/**
	 * Returns a generator for the entries in the HashMap.
	 */
	*entries(): IterableIterator<[T, V]> {
		for (const bucket of this._buckets.values()) {
			for (const { key, value } of bucket) {
				yield [key, value];
			}
		}
	}

	/**
	 * Returns a generator for the keys in the HashMap.
	 */
	*keys(): IterableIterator<T> {
		for (const bucket of this._buckets.values()) {
			for (const { key } of bucket) {
				yield key;
			}
		}
	}

	/**
	 * Returns a generator for the values in the HashMap.
	 */
	*values(): IterableIterator<V> {
		for (const bucket of this._buckets.values()) {
			for (const { value } of bucket) {
				yield value;
			}
		}
	}

	/**
	 * Makes the HashMap iterable (using its [Symbol.iterator]).
	 * Iterates over [key, value] pairs.
	 */
	override [Symbol.iterator](): IterableIterator<[T, V]> {
		return this.entries();
	}

	/**
	 * For compatibility: forEach method similar to native Map.
	 *
	 * @param callbackfn - Function to execute for each key and value.
	 * @param thisArg - Optional. Value to use as "this" when executing callbackfn.
	 */
	override forEach(
		callbackfn: (value: V, key: T, map: HashMap<T, V>) => void,
		thisArg?: any
	): void {
		for (const [key, value] of this.entries()) {
			callbackfn.call(thisArg, value, key, this);
		}
	}
}