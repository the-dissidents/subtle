export type EventHandler<T extends unknown[]> = (...args: [...T]) => void | Promise<void>;

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
            // console.log(`dispatch`, obj, f, this);
            f.forEach(([x, _]) => x(...args));
            this.#listeners.set(k, f.filter(([_, y]) => !y.once));
        }
    };

    async dispatchAndAwaitAll(...args: [...T]) {
        const list = [...this.#listeners]
            .flatMap(([_, f]) => f.map(([x, _]) => x(...args)))
            .filter((x) => x !== undefined);
        await Promise.allSettled(list);
        for (const [k, f] of [...this.#listeners])
            this.#listeners.set(k, f.filter(([_, y]) => !y.once));
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
