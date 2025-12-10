import type { TypedArray } from "../Basic";
import { Debug } from "../Debug";

export type BufferHandle<T extends TypedArray> = {
    get data(): T,
    delete(): void
};

export class SlabBuffer<T extends TypedArray> {
    #occupied: boolean[] = [];
    #buffer: T;

    constructor(
        private type: new (n: number) => T,
        private maxCapacity: number,
        private maxItemSize: number
    ) {
        const len = maxCapacity * maxItemSize;
        Debug.debug(`allocating pool: ${maxCapacity} * ${maxItemSize} = ${len}`);
        this.#buffer = new type(maxCapacity * maxItemSize);
        this.#occupied = new Array(maxCapacity);
    }

    resize(maxCapacity: number, maxItemSize: number) {
        Debug.assert(this.#occupied.find((x) => x) === undefined);
        const len = maxCapacity * maxItemSize;
        Debug.debug(`reallocating pool: ${maxCapacity} * ${maxItemSize} = ${len}`);
        this.#buffer = new this.type(maxCapacity * maxItemSize);
        this.maxCapacity = maxCapacity;
        this.maxItemSize = maxItemSize;
        this.#occupied = new Array(maxCapacity);
        return this;
    }

    allocate(n: number): BufferHandle<T> {
        const i = this.#occupied.findIndex((x) => !x);
        Debug.assert(i >= 0);
        Debug.assert(n <= this.maxItemSize);

        const start = i * this.maxCapacity;
        // Debug.trace(`allocated buffer handle id=${i}`);
        const view = this.#buffer.slice(start, start + n);
        this.#occupied[i] = true;

        let deleted = false;
        return {
            get data() {
                Debug.assert(!deleted);
                return view as T;
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