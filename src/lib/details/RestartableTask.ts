import { Debug } from "../Debug";

export type CancellationToken = {
    readonly isCancelled: boolean;
};

type Request<Arg> = {
    arg: Arg,
    onDone: () => void;
    onReject: (err: unknown) => void;
    isCancelled: boolean;
};

type State<Arg> = {
    type: 'running',
    current: Request<Arg>
} | {
    type: 'cancelling',
    current: Request<Arg>,
    new: Request<Arg>
} | {
    type: 'idle'
};

export type RestartableTaskOptions<Arg extends unknown[]> = {
    deduplicator?: (a: Arg, b: Arg) => boolean
}

export class RestartableTask<Arg extends unknown[]> {
    private state: State<Arg> = { type: 'idle' };

    constructor(
        private executor: (arg: Arg, token: CancellationToken) => Promise<void>,
        private options?: RestartableTaskOptions<Arg>
    ) {}

    async request(...arg: Arg) {
        const old = this.state.type == 'running' ? this.state.current.arg
                : this.state.type == 'cancelling' ? this.state.new.arg
                : undefined
        if (old && this.options?.deduplicator?.(old, arg)) return;

        return new Promise<void>((resolve, reject) => {
            const request: Request<Arg> = { 
                arg,
                isCancelled: false, 
                onDone: () => resolve(),
                onReject: (err) => reject(err)
            };
            if (this.state.type == 'idle')
                this.#execute(request);
            else {
                this.state = { 
                    type: 'cancelling', 
                    current: this.state.current, 
                    new: request
                };
                this.state.current.isCancelled = true;
            }
        })
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