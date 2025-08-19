import { Debug } from "../Debug";

export type CancellationToken = {
    readonly isCancelled: boolean;
};

type CancellationTokenImpl = {
    isCancelled: boolean;
    onDone: () => void;
    onReject: (err: unknown) => void;
}

type State<Arg> = {
    type: 'running',
    arg: Arg
    token: CancellationTokenImpl
} | {
    type: 'idle'
};

export class RestartableTask<Arg extends any[]> {
    private state: State<Arg> = { type: 'idle' };
    private pending?: [Arg, CancellationTokenImpl];

    constructor(
        private executor: (arg: Arg, token: CancellationToken) => Promise<void>,
        private deduplicator: (a: Arg, b: Arg) => boolean = () => false
    ) {}

    async request(...arg: Arg) {
        let old = this.pending?.[0];
        if (!old && this.state.type == 'running') old = this.state.arg;
        if (old && this.deduplicator(old, arg)) return;

        return new Promise<void>((resolve, reject) => {
            const token: CancellationTokenImpl = { 
                isCancelled: false, 
                onDone: () => resolve(),
                onReject: (err) => reject(err)
            };
            if (this.state.type == 'idle')
                this.#execute(arg, token);
            else {
                this.state.token.isCancelled = true;
                this.pending = [arg, token];
            }
        })
    }

    async #execute(arg: Arg, token: CancellationTokenImpl) {
        Debug.assert(this.state.type == 'idle');
        this.state = { type: 'running', arg, token };
        try {
            await this.executor(arg, token);
            token.onDone();
        } catch (e) {
            await Debug.forwardError(e);
            token.onReject(e);
        } finally {
            this.state = { type: 'idle' };
            if (this.pending !== undefined) {
                const pending = this.pending;
                this.pending = undefined;
                this.#execute(...pending);
            }
        }
    }
}