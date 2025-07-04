console.info('Debug loading');

import { invoke } from "@tauri-apps/api/core";
import * as log from "@tauri-apps/plugin-log"
import * as StackTrace from "stacktrace-js";
import inspect from "object-inspect";

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

function formatData(data: any[]) {
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
}

async function stacktrace(from?: Error) {
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
    filterLevel: LogLevelFilter,
    redirectNative: boolean,
    setPersistentFilterLevel(level: LogLevelFilter): Promise<void>,
    init(): Promise<void>,
    trace(...data: any[]): Promise<void>,
    debug(...data: any[]): Promise<void>,
    info(...data: any[]): Promise<void>,
    warn(...data: any[]): Promise<void>,
    error(...data: any[]): Promise<void>,
    assert(cond: boolean, what?: string): asserts cond,
    early(reason?: string): void,
    never(value?: never): never
} = {
    filterLevel: LogLevelFilter.Debug,
    redirectNative: true,
    async setPersistentFilterLevel(level: LogLevelFilter) {
        this.trace('set persistent filter level', LogLevelFilter[level]);
        await invoke('set_log_filter_level', { u: level });
    },
    async init() {
        await log.attachLogger(({level, message}) => {
            if (level < FilterToLevel[this.filterLevel]
             || (!this.redirectNative && !message.includes('][webview'))
            //  || message.includes('!!!WEBVIEW_STACKTRACE')
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
                case LogLevel.Error:
                    console.error(message);
                    break;
            }
        });

        window.addEventListener('error', async (ev) => {
            if (ev.error instanceof Error) {
                let { file, trace } = await stacktrace(ev.error);
                callLog(LogLevel.Error, 
                    formatData([`Unhandled error`, ev.error, ev.message]), file);
                if (!HasStacktrace.has(ev.error))
                    callLog(LogLevel.Error, `!!!WEBVIEW_STACKTRACE\n` + trace);
            } else {
                callLog(LogLevel.Error, 
                    formatData([`Unhandled error`, ev.error]), '?');
            }
            return true;
        });
        window.addEventListener('unhandledrejection', async (ev) => {
            ev.preventDefault();
            if (ev.reason instanceof Error) {
                let { file, trace } = await stacktrace(ev.reason);
                callLog(LogLevel.Error, 
                    formatData([`Unhandled rejection`, ev.reason, ev.reason.message]), file);
                if (!HasStacktrace.has(ev.reason))
                    callLog(LogLevel.Error, `!!!WEBVIEW_STACKTRACE\n` + trace);
            } else {
                callLog(LogLevel.Error, 
                    formatData([`Unhandled rejection`, ev.reason]), '?');
            }
        });
    },
    async trace(...data: any[]) {
        const { file } = await stacktrace();
        callLog(LogLevel.Trace, formatData(data), file);
    },
    async debug(...data: any[]) {
        const { file, trace } = await stacktrace();
        callLog(LogLevel.Debug, formatData(data), file);
        // callLog(LogLevel.Trace, `!!!WEBVIEW_STACKTRACE\n` + trace);
    },
    async info(...data: any[]) {
        const { file, trace } = await stacktrace();
        callLog(LogLevel.Info, formatData(data), file);
        // callLog(LogLevel.Trace, `!!!WEBVIEW_STACKTRACE\n` + trace);
    },
    async warn(...data: any[]) {
        const { file, trace } = await stacktrace();
        callLog(LogLevel.Warn, formatData(data), file);
        callLog(LogLevel.Info, `!!!WEBVIEW_STACKTRACE\n` + trace);
    },
    async error(...data: any[]) {
        const { file, trace } = await stacktrace();
        callLog(LogLevel.Error, formatData(data), file);
        callLog(LogLevel.Error, `!!!WEBVIEW_STACKTRACE\n` + trace);
    },
    assert(cond: boolean, what?: string): asserts cond {
        if (!!!cond) {
            const msg = 'assertion failed' + (what ? `: ${what}` : '');
            this.error(msg);
            const error = new Error(msg);
            HasStacktrace.add(error);
            throw error;
        }
    },
    early(reason?: string): void {
        (async () => {
            const { file, func, trace } = await stacktrace();
            callLog(LogLevel.Info, `<${func}> returned early` + (reason ? `: ${reason}` : ''), file);
            callLog(LogLevel.Info, `!!!WEBVIEW_STACKTRACE\n` + trace);
        })();
    },
    never(x?: never): never {
        (async () => {
            const { file, func, trace } = await stacktrace();
            callLog(LogLevel.Error, `Unreachable code reached (never=${x})`, file);
            callLog(LogLevel.Error, `!!!WEBVIEW_STACKTRACE\n` + trace);
        })();
        const error = new Error('unreachable code reached');
        HasStacktrace.add(error);
        throw error;
    }
}