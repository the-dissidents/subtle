console.info('Debug loading');

import { invoke } from "@tauri-apps/api/core";
import * as log from "@tauri-apps/plugin-log"
import * as StackTrace from "stacktrace-js";
import inspect from "object-inspect";
import { EventHost } from "./details/EventHost";

/** Strangely tauri's log plugin does not export this enum, so it is recreated here */
export enum LogLevel {
    Trace = 1,
    Debug = 2,
    Info = 3,
    Warn = 4,
    Error = 5
}

export enum LogLevelFilter {
    Off = 0,
    Error = 1,
    Warn = 2,
    Info = 3,
    Debug = 4,
    Trace = 5,
}

export const GetLevelFilter = {
    Off: 0,
    Error: 1,
    Warn: 2,
    Info: 3,
    Debug: 4,
    Trace: 5,
};

const FilterToLevel = [0, 5, 4, 3, 2, 1];

async function callLog(level: LogLevel, message: string, location?: string) {
    await invoke('plugin:log|log', {
        level,
        message,
        location,
        file: undefined,
        line: undefined,
        key_values: undefined
    });
}

function formatPrelude(level: string, file: string) {
    const now = new Date();
    return `${now.getFullYear()
        }-${now.getMonth().toString().padStart(2, '0')
        }-${now.getDay().toString().padStart(2, '0')
        }@${now.getHours().toString().padStart(2, '0')
        }:${now.getMinutes().toString().padStart(2, '0')
        }:${now.getSeconds().toString().padStart(2, '0')
        }.${now.getMilliseconds().toString().padStart(3, '0')
        }[${level}][webview:${file}] `;
}

function formatData(data: unknown[]) {
    if (data.length == 0)
        return '';
    let result = '';
    if (typeof data[0] == 'string') {
        result = data[0];
        data.shift();
    }
    data.forEach((x) => result += ' ' + inspect(x));
    return result;
}

const Filter = {
    filter: (stackFrame: StackTrace.StackFrame) => 
        !(stackFrame.getFileName()?.endsWith('src/lib/Debug.ts')) 
        && !(stackFrame.getFunctionName()?.includes('StackTrace$$')),
    offline: true
};

async function stacktrace(from?: Error) {
    // return {
    //     file: '...',
    //     func: '...',
    //     trace: from?.stack ?? ''
    // };
    const frames = from 
        ? await StackTrace.fromError(from, Filter) 
        : StackTrace.getSync(Filter);
    return {
        file: frames[0]?.fileName?.split(/\/|\\/)?.at(-1) ?? '?',
        func: frames[0]?.getFunctionName() ?? '?',
        trace: frames.map((x) => '--> ' + x.toString()).join('\n')};
}

const HasStacktrace = new WeakSet<Error>();

export const Debug: {
    onError: EventHost<[origin: string, msg: string]>,
    filterLevel: LogLevelFilter,
    redirectNative: boolean,
    setPersistentFilterLevel(level: LogLevelFilter): Promise<void>,
    init(): Promise<void>,
    trace(...data: unknown[]): Promise<void>,
    debug(...data: unknown[]): Promise<void>,
    info(...data: unknown[]): Promise<void>,
    warn(...data: unknown[]): Promise<void>,
    error(...data: unknown[]): Promise<void>,
    forwardError(e: Error | unknown): Promise<void>,
    assert(cond: boolean, what?: string): asserts cond,
    early(reason?: string): void,
    never(value?: never): never
} = {
    onError: new EventHost<[origin: string, msg: string]>(),
    filterLevel: LogLevelFilter.Debug,
    redirectNative: true,
    async setPersistentFilterLevel(level: LogLevelFilter) {
        await invoke('set_log_filter_level', { u: level });
    },
    async init() {
        await log.attachLogger(({level, message}) => {
            if (message.includes('][webview')
             || level < FilterToLevel[this.filterLevel]
             || !this.redirectNative
            ) return;

            switch (level) {
                case LogLevel.Trace:
                    console.debug(message);
                    break;
                case LogLevel.Debug:
                    console.debug(message);
                    break;
                case LogLevel.Info:
                    console.info(message);
                    break;
                case LogLevel.Warn:
                    console.warn(message);
                    break;
                case LogLevel.Error: {
                    console.error(message);
                    const match = /^([\d-@:.]+)\[(.*?)\]\[(.*?)\](.*)$/.exec(message);
                    if (match)
                        this.onError.dispatch(match[3], match[4]);
                    else
                        this.onError.dispatch('?', message);
                    break;
                }
            }
        });

        window.addEventListener('error', async (ev) => {
            if (!HasStacktrace.has(ev.error)) {
                // hack: demote ResizeObserver errors
                // see https://github.com/the-dissidents/subtle/issues/123
                if (ev.message.startsWith('ResizeObserver loop completed with')) {
                    Debug.warn('ResizeObserver loop completed with undelivered notifications');
                    return true;
                }
                Debug.error(`Unhandled error: ${ev.message} [${ev.filename}:${ev.lineno},${ev.colno}]`, ev.error);
            }
            return true;
        });
        window.addEventListener('unhandledrejection', async (ev) => {
            ev.preventDefault();
            if (!HasStacktrace.has(ev.reason)) {
                Debug.error(`Unhandled rejection`, ev.reason);
            }
        });
    },
    async trace(...data: unknown[]) {
        const { file } = await stacktrace();
        if (this.filterLevel >= LogLevelFilter.Trace)
            console.log(formatPrelude('TRACE', file), ...data);
        callLog(LogLevel.Trace, formatData(data), file);
    },
    async debug(...data: unknown[]) {
        const { file, trace: _ } = await stacktrace();
        if (this.filterLevel >= LogLevelFilter.Debug)
            console.debug(formatPrelude('DEBUG', file), ...data);
        callLog(LogLevel.Debug, formatData(data), file);
    },
    async info(...data: unknown[]) {
        const { file, trace: _ } = await stacktrace();
        if (this.filterLevel >= LogLevelFilter.Info)
            console.info(formatPrelude('INFO', file), ...data);
        callLog(LogLevel.Info, formatData(data), file);
    },
    async warn(...data: unknown[]) {
        const { file, trace: _ } = await stacktrace();
        if (this.filterLevel >= LogLevelFilter.Warn)
            console.warn(formatPrelude('WARN', file), ...data);
        callLog(LogLevel.Warn, formatData(data), file);
    },
    async error(...data: unknown[]) {
        const { file, trace } = await stacktrace();
        if (this.filterLevel >= LogLevelFilter.Error)
            console.error(formatPrelude('ERROR', file), ...data);
        const format = formatData(data);
        this.onError.dispatch(file, format);
        callLog(LogLevel.Error, format, file);
        callLog(LogLevel.Error, `!!!WEBVIEW_STACKTRACE\n` + trace);
    },
    async forwardError(e: Error | unknown) {
        if (e instanceof Error) {
            const { file, trace } = await stacktrace(e);
            if (this.filterLevel >= LogLevelFilter.Error)
                console.error(formatPrelude('ERROR', file), e);
            const format = formatData([e]);
            this.onError.dispatch(file, format);
            callLog(LogLevel.Error, format, file);
            callLog(LogLevel.Error, `!!!WEBVIEW_STACKTRACE\n` + trace);
        } else {
            await this.error(e);
        }
    },
    assert(cond: boolean, file?: string, line?: number): asserts cond {
        if (!cond) {
            const msg = 'assertion failed ' + (line ? `at line ${line}` : '(no location info)');
            file ??= '?';
            if (this.filterLevel >= LogLevelFilter.Error)
                console.error(formatPrelude('ERROR', file), msg);
            this.onError.dispatch(file, msg);
            callLog(LogLevel.Error, msg, file);

            const error = new Error(msg);
            HasStacktrace.add(error);
            throw error;
        }
    },
    early(file?: string, func?: string, line?: number): void {
        (async () => {
            func ??= 'unknown';
            file ??= '?';
            callLog(LogLevel.Info, `<${func}> returned early ` 
                + (line ? `at line ${line}` : '(no location info)'), file);
        })();
    },
    never(x?: never): never {
        const msg = `Unreachable code reached (never=${x})`;
        this.error(msg);
        const error = new Error(msg);
        HasStacktrace.add(error);
        throw error;
    }
}