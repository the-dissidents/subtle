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

function stacktrace(): {file: string, trace: string} {
    const frames = StackTrace.getSync({filter(stackFrame) {
        return !(stackFrame.getFileName()?.endsWith('src/lib/Debug.ts')) 
            && !(stackFrame.getFunctionName()?.includes('StackTrace$$'));
    }});
    return {
        file: frames[0]?.fileName?.split(/\/|\\/)?.at(-1) ?? '?',
        trace: `!!!WEBVIEW_STACKTRACE\n` + frames.map((x) => '--> ' + x.toString()).join('\n')};
}

export const Debug = {
    filterLevel: LogLevelFilter.Debug,
    async setPersistentFilterLevel(level: LogLevelFilter) {
        await invoke('set_log_filter_level', { level });
    },
    async init() {
        await log.attachLogger(({level, message}) => {
            if (level < FilterToLevel[this.filterLevel]
             || message.includes('!!!WEBVIEW_STACKTRACE')) return;

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
        callLog(LogLevel.Trace, trace);
    },
    async info(msg: string) {
        const { file, trace } = stacktrace();
        callLog(LogLevel.Info, msg, file);
        callLog(LogLevel.Debug, trace);
    },
    async warn(msg: string) {
        const { file, trace } = stacktrace();
        callLog(LogLevel.Warn, msg, file);
        callLog(LogLevel.Info, trace);
    },
    async error(msg: string) {
        const { file, trace } = stacktrace();
        callLog(LogLevel.Error, msg, file);
        callLog(LogLevel.Error, trace);
    },
    assert(cond: boolean): asserts cond {
        if (!!!cond) {
            const { file, trace } = stacktrace();
            callLog(LogLevel.Error, 'Assertion failed', file);
            callLog(LogLevel.Error, trace);
        }
    }
}