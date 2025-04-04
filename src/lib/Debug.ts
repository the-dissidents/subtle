import { invoke } from "@tauri-apps/api/core";
import * as log from "@tauri-apps/plugin-log"
import StackTrace from "stacktrace-js";

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

function stacktrace() {
    const frames = StackTrace.getSync({
        filter: (stackFrame) => 
               !(stackFrame.getFileName()?.endsWith('src/lib/Debug.ts')) 
            && !(stackFrame.getFunctionName()?.includes('StackTrace$$'))
    });
    return {
        file: frames[0]?.fileName?.split(/\/|\\/)?.at(-1) ?? '?',
        func: frames[0]?.getFunctionName() ?? '?',
        trace: frames.map((x) => '--> ' + x.toString()).join('\n')};
}

export const Debug: {
    filterLevel: LogLevelFilter,
    redirectNative: boolean,
    setPersistentFilterLevel(level: LogLevelFilter): Promise<void>,
    init(): Promise<void>,
    trace(msg: string): Promise<void>,
    debug(msg: string): Promise<void>,
    info(msg: string): Promise<void>,
    warn(msg: string): Promise<void>,
    error(msg: string): Promise<void>,
    assert(cond: boolean): asserts cond,
    early(reason?: string): void,
    never(value: never): never
} = {
    filterLevel: LogLevelFilter.Debug,
    redirectNative: true,
    async setPersistentFilterLevel(level: LogLevelFilter) {
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
    },
    async trace(msg: string) {
        const { file } = stacktrace();
        callLog(LogLevel.Trace, msg, file);
    },
    async debug(msg: string) {
        const { file, trace } = stacktrace();
        callLog(LogLevel.Debug, msg, file);
        callLog(LogLevel.Trace, `!!!WEBVIEW_STACKTRACE\n` + trace);
    },
    async info(msg: string) {
        const { file, trace } = stacktrace();
        callLog(LogLevel.Info, msg, file);
        callLog(LogLevel.Trace, `!!!WEBVIEW_STACKTRACE\n` + trace);
    },
    async warn(msg: string) {
        const { file, trace } = stacktrace();
        callLog(LogLevel.Warn, msg, file);
        callLog(LogLevel.Info, `!!!WEBVIEW_STACKTRACE\n` + trace);
    },
    async error(msg: string) {
        const { file, trace } = stacktrace();
        callLog(LogLevel.Error, msg, file);
        callLog(LogLevel.Error, `!!!WEBVIEW_STACKTRACE\n` + trace);
    },
    assert(cond: boolean): asserts cond {
        if (!!!cond) {
            const { file, trace } = stacktrace();
            callLog(LogLevel.Error, 'Assertion failed', file);
            callLog(LogLevel.Error, `!!!WEBVIEW_STACKTRACE\n` + trace);
            throw new Error('assertion failed');
        }
    },
    early(reason?: string): void {
        const { file, func, trace } = stacktrace();
        callLog(LogLevel.Info, `<${func}> returned early` + (reason ? `: ${reason}` : ''), file);
        callLog(LogLevel.Info, `!!!WEBVIEW_STACKTRACE\n` + trace);
    },
    never(x: never): never {
        const { file, trace } = stacktrace();
        callLog(LogLevel.Error, `Unreachable code reached (never=${x})`, file);
        callLog(LogLevel.Error, `!!!WEBVIEW_STACKTRACE\n` + trace);
        throw new Error('unreachable code reached');
    }
}