import type { TypedArray } from "../Basic";
import { Debug } from "../Debug";

export class AggregationTree<T extends TypedArray> {
    #data: T;
    #layers: number;
    #leafStart: number

    constructor(
        ctor: new (n: number) => T,
        public readonly length: number,
        /** Must be an associative operation */
        public readonly aggregator: (a: number, b: number) => number,
        private readonly initial = NaN
    ) {
        Debug.assert(length > 1);
        this.#layers = Math.ceil(Math.log2(length)) + 1;
        this.#leafStart = 2 ** (this.#layers - 1) - 1;
        this.#data = new ctor(this.#leafStart + length);
        this.#data.fill(initial);
    }

    clear() {
        this.#data.fill(this.initial);
    }

    set(values: ArrayLike<number>, start: number) {
        if (values.length == 0) return;

        let first: number | null = this.#leafStart + start;
        let last: number | null = first + values.length - 1;
        Debug.assert(start >= 0 && last < this.#data.length, 
            `set: start/end out of bound [${first}-${last}] vs [${this.#leafStart}-${this.#data.length}]`);
        this.#data.set(values, first);

        while (true) {
            first = this.#parent(first);
            last = this.#parent(last);
            if (first === null || last === null) break;
            for (let i = first; i <= last; i++)
                this.#aggregateNode(i);
        }
    }

    fill(value: number, start: number, end: number) {
        Debug.assert(end >= start);
        let first: number | null = this.#leafStart + start;
        let last: number | null = this.#leafStart + end;
        Debug.assert(start >= 0 && last < this.#data.length);
        this.#data.fill(value, first, last);

        while (true) {
            first = this.#parent(first);
            last = this.#parent(last);
            if (first === null || last === null) break;
            for (let i = first; i <= last; i++)
                this.#aggregateNode(i);
        }
    }

    /**
     * @param resolution must be an integer power of 2
     */
    getLevel(resolution: number): Readonly<T> {
        const level = Math.log2(resolution);
        Debug.assert(level % 1 == 0 && resolution <= this.length);
        const layer = this.#layers - level;
        return this.#data.subarray(2 ** (layer - 1) - 1, 2 ** layer - 1) as T;
    }

    #parent(index: number) {
        if (index == 0) return null;
        return Math.floor((index - 1) / 2);
    }

    #aggregateNode(index: number) {
        Debug.assert(index >= 0 && index * 2 + 1 < this.#data.length);
        const left  = this.#data[index * 2 + 1];
        const right = index * 2 + 2 < this.#data.length ? this.#data[index * 2 + 2] : NaN;
        let value: number;
        if (isNaN(left) && isNaN(right)) value = NaN;
        else if (isNaN(left)) value = right;
        else if (isNaN(right)) value = left;
        else value = this.aggregator(left, right);
        this.#data[index] = value;
    }
}