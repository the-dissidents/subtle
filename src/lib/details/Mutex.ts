import { Debug } from "../Debug";

export class Mutex {
    #busy = false;
    #queue: (() => void)[] = [];

    /**
     * Whether the mutex has been acquired by something.
     */
    get isBusy() {
        return this.#busy;
    }

    constructor(private timeout = -1, private debugName = '<unnamed>') {}

    /**
     * Acquire the mutex, possibly waiting for it to become available.
     * Use `Mutex.use` instead of this whenever possible.
     */
    async acquire() {
        if (!this.#busy) {
            this.#busy = true;
            return;
        }
        return new Promise<void>((resolve) => {
            const id = this.timeout <= 0 
                ? undefined 
                : setTimeout(() => Debug.warn(
                    `mutex ${this.debugName} has been waiting for ~${this.timeout}ms`),
                    this.timeout);
            this.#queue.push(() => {
                this.#busy = true;
                clearTimeout(id);
                resolve();
            })
        });
    }

    /**
     * Acquire the mutex only if it's immediately available.
     * @returns `true` if successful.
     */
    acquireIfIdle() {
        if (!this.#busy) {
            this.#busy = true;
            return true;
        }
        return false;
    }

    /**
     * Release the mutex.
     * Use `Mutex.use` instead of this whenever possible.
     */
    release() {
        if (this.#queue.length > 0) {
            this.#queue.shift()!();
        } else {
            this.#busy = false;
        }
    }

    /**
     * Safely acquire and release the mutex before and after executing the function, regardless of whether it throws.
     */
    async use<T>(f: () => T | Promise<T>) {
        await this.acquire();
        try {
            return await f();
        } finally {
            this.release();
        }
    }
}