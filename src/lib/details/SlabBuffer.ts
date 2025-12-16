import type { TypedArray } from "../Basic";
import { Debug } from "../Debug";

const GROW_FACTOR = 1.5;

export type BufferHandle<T extends TypedArray> = {
    get data(): T,
    delete(): void
};

export class SlabBuffer<T extends TypedArray> {
    #occupied: boolean[] = [];
    #buffer: T;

    get maxCapacity() { return this._maxCapacity; }
    get maxItemSize() { return this._maxItemSize; }

    constructor(
        private type: new (n: number) => T,
        private _maxCapacity: number,
        private _maxItemSize: number
    ) {
        const len = _maxCapacity * _maxItemSize;
        Debug.debug(`allocating pool: ${_maxCapacity} * ${_maxItemSize} = ${len}`);
        this.#buffer = new type(_maxCapacity * _maxItemSize);
        this.#occupied = new Array(_maxCapacity);
        this.#occupied.fill(false);
    }

    #resize(maxCapacity: number, maxItemSize: number) {
        if (maxCapacity == this._maxCapacity && maxItemSize == this._maxItemSize) {
            Debug.early();
            return this;
        }

        Debug.assert(this.#occupied.find((x) => x) === undefined);
        const len = maxCapacity * maxItemSize;
        Debug.debug(`reallocating pool: ${maxCapacity} * ${maxItemSize} = ${len}`);
        this.#buffer = new this.type(maxCapacity * maxItemSize);
        this._maxCapacity = maxCapacity;
        this._maxItemSize = maxItemSize;
        this.#occupied = new Array(maxCapacity);
        return this;
    }

    resize(maxCapacity: number, maxItemSize: number) {
        if (maxCapacity == this._maxCapacity && maxItemSize == this._maxItemSize) {
            Debug.early();
            return this;
        }

        if (this.#occupied.find((x) => x) === undefined)
            return this.#resize(maxCapacity, maxItemSize);
        
        const len = maxCapacity * maxItemSize;
        Debug.assert(maxCapacity >= this._maxCapacity && maxItemSize >= this._maxItemSize);
        Debug.warn(`reallocating pool SLOW: ${maxCapacity} * ${maxItemSize} = ${len}`);

        const newBuffer = new this.type(maxCapacity * maxItemSize);
        for (let i = 0; i < this._maxCapacity; i++) {
            if (this.#occupied[i]) {
                const start = i * this._maxItemSize;
                const end = start + this._maxItemSize;
                newBuffer.set(this.#buffer.subarray(start, end), i * maxItemSize);
            }
        }
        this.#buffer = newBuffer;
        this.#occupied.length = maxCapacity;
        this.#occupied.fill(false, this._maxCapacity);
        this._maxCapacity = maxCapacity;
        this._maxItemSize = maxItemSize;
        return this;
    }

    allocate(n: number): BufferHandle<T> {
        const i = this.#occupied.findIndex((x) => !x);
        if (i < 0 || n > this._maxItemSize) {
            this.resize(
                Math.ceil(this._maxCapacity * (i < 0 ? GROW_FACTOR : 1)),
                Math.max(this._maxItemSize, Math.ceil(n * GROW_FACTOR))
            );
            return this.allocate(n);
        }

        this.#occupied[i] = true;
        // Debug.trace(`allocated buffer handle id=${i}`);

        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const slab = this;
        let deleted = false;
        return {
            get data() {
                Debug.assert(!deleted);
                const start = i * slab._maxItemSize;
                return slab.#buffer.subarray(start, start + n) as T;
            },
            delete: () => {
                Debug.assert(!deleted);
                deleted = true;
                this.#occupied[i] = false;
                // Debug.trace(`freed buffer handle id=${i}`);
            },
        };
    }
}