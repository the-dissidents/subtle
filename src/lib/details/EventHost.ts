export type EventHandler<T extends unknown[]> = (...args: [...T]) => void;
export type AsyncEventHandler<T extends unknown[]> = (...args: [...T]) => void | Promise<void>;

export type EventHandlerOptions = {
    once?: boolean;
};

export class EventHost<T extends unknown[] = []> {
    #listeners = new Map<object, [EventHandler<T>, EventHandlerOptions][]>();

    static globalEventHosts: EventHost<any>[] = [];
    constructor() {
        EventHost.globalEventHosts.push(this);
    }

    dispatch(...args: [...T]) {
        for (const [k, f] of [...this.#listeners]) {
            try {
                f.forEach(([x, _]) => x(...args));
            } finally {
                this.#listeners.set(k, f.filter(([_, y]) => !y.once));
            }
        }
    };

    bind(obj: object, f: (...args: [...T]) => void | Promise<void>,
        options: EventHandlerOptions = {}
    ) {
        if (!this.#listeners.has(obj))
            this.#listeners.set(obj, []);
        this.#listeners.get(obj)!.push([f, options]);
        // console.log(`bind`, obj, f, this);
    }

    static unbind(obj: object) {
        for (const host of EventHost.globalEventHosts) {
            // console.log(`unbind`, host.#listeners.get(obj), this);
            host.#listeners.delete(obj);
        }
    }
}

export class AsyncEventHost<T extends unknown[] = []> {
    #listeners = new Map<object, [EventHandler<T>, EventHandlerOptions][]>();

    static globalEventHosts: AsyncEventHost<any>[] = [];
    constructor() {
        AsyncEventHost.globalEventHosts.push(this);
    }

    async dispatchAndAwaitAll(...args: [...T]) {
        try {
            const list = [...this.#listeners]
                .flatMap(([_, f]) => f.map(([x, _]) => x(...args)))
                .filter((x) => x !== undefined);
            await Promise.allSettled(list);
        } finally {
            for (const [k, f] of [...this.#listeners])
                this.#listeners.set(k, f.filter(([_, y]) => !y.once));
        }
    };

    bind(obj: object, f: (...args: [...T]) => void | Promise<void>,
        options: EventHandlerOptions = {}
    ) {
        if (!this.#listeners.has(obj))
            this.#listeners.set(obj, []);
        this.#listeners.get(obj)!.push([f, options]);
    }

    static unbind(obj: object) {
        for (const host of AsyncEventHost.globalEventHosts) {
            host.#listeners.delete(obj);
        }
    }
}