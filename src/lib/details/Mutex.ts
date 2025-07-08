import { Debug } from "../Debug";

export class Mutex {
    #busy = false;
    #queue: (() => void)[] = [];

    get isBusy() {
        return this.#busy;
    }

    constructor(private timeout = -1) {}

    async acquire() {
        if (!this.#busy) {
            this.#busy = true;
            return;
        }
        return new Promise<void>((resolve) => {
            const id = this.timeout <= 0 
                ? undefined 
                : setTimeout(
                    () => Debug.warn(`mutex has been waiting for ~${this.timeout}ms`),
                    this.timeout);
            this.#queue.push(() => {
                this.#busy = true;
                clearTimeout(id);
                resolve();
            })
        });
    }

    acquireIfIdle() {
        if (!this.#busy) {
            this.#busy = true;
            return true;
        }
        return false;
    }

    release() {
        if (this.#queue.length > 0) {
            this.#queue.shift()!();
        } else {
            this.#busy = false;
        }
    }
}