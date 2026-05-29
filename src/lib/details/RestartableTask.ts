import { Debug } from "../Debug";

export type CancellationToken = {
    readonly isCancelled: boolean;
};

type Request<Arg> = {
    arg: Arg;
    onDone: () => void;
    onReject: (err: unknown) => void;
    isCancelled: boolean;
};

type State<Arg> = {
    type: 'running';
    current: Request<Arg>;
} | {
    type: 'scheduled';
    current: Request<Arg>;
    timer: ReturnType<typeof setTimeout>;
} | {
    type: 'cancelling';
    current: Request<Arg>;
    new: Request<Arg>;
} | {
    type: 'idle';
};

export type RestartableTaskOptions<Arg extends unknown[]> = {
    deduplicator?: (a: Arg, b: Arg) => boolean;
    debounceMs?: number;
};

export class RestartableTask<Arg extends unknown[]> {
    private state: State<Arg> = { type: 'idle' };

    constructor(
        private executor: (arg: Arg, token: CancellationToken) => Promise<void>,
        private options?: RestartableTaskOptions<Arg>
    ) {}

    async request(...arg: Arg) {
        const old = this.state.type == 'running' ? this.state.current.arg
                : this.state.type == 'scheduled' ? this.state.current.arg
                : this.state.type == 'cancelling' ? this.state.new.arg
                : this.state.type == 'idle' ? undefined
                : Debug.never(this.state);

        if (old && this.options?.deduplicator?.(old, arg)) return;

        return new Promise<void>((resolve, reject) => {
            const request: Request<Arg> = {
                arg,
                isCancelled: false,
                onDone: () => resolve(),
                onReject: (err) => reject(err)
            };

            if (this.state.type == 'idle') {
                const debounce = this.options?.debounceMs;
                if (debounce && debounce > 0)
                    this.#schedule(request);
                else
                    this.#execute(request);
            } else if (this.state.type == 'scheduled') {
                this.state.current.onDone(); // destroy the unused promise
                clearTimeout(this.state.timer);
                this.#schedule(request);
            } else {
                if (this.state.type == 'cancelling')
                    this.state.new.onDone(); // destroy the unused promise

                this.state = {
                    type: 'cancelling',
                    current: this.state.current,
                    new: request
                };
                this.state.current.isCancelled = true;
            }
        })
    }

    #schedule(request: Request<Arg>) {
        const debounce = this.options?.debounceMs;
        Debug.assert(!!debounce && debounce > 0);
        this.state = {
            type: 'scheduled',
            current: request,
            timer: setTimeout(() => this.#execute(request), debounce)
        };
    }

    async #execute(request: Request<Arg>) {
        Debug.assert(this.state.type !== 'running');
        this.state = { type: 'running', current: request };
        try {
            await this.executor(request.arg, request);
            request.onDone();
        } catch (e) {
            Debug.forwardError(e);
            request.onReject(e);
        } finally {
            const state = this.state as State<Arg>;
            if (state.type === 'cancelling')
                this.#execute(state.new);
            else
                this.state = { type: 'idle' };
        }
    }
}
