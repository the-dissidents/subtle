import { path } from "@tauri-apps/api";
import * as os from "@tauri-apps/plugin-os";
import { PublicConfig, PublicConfigGroup } from "./PublicConfig.svelte";

export const MainConfig = new PublicConfig('main');

export const InterfaceConfig = new PublicConfigGroup(
    'interface',
    '',
{
    language: {
        localizedName: 'language',
        type: 'dropdown',
        options: {
            en: { localizedName: 'English' },
            chs: { localizedName: '简体中文' },
            cht: { localizedName: '繁体中文' }
        },
        default: 'en'
    },
    theme: {
        localizedName: 'theme',
        type: 'select',
        options: {
            light: {
                localizedName: 'light'
            },
            dark: {
                localizedName: 'dark'
            },
            auto: {
                localizedName: 'use system theme'
            }
        },
        default: 'light'
    }
});
MainConfig.addGroup('interface', InterfaceConfig);

export const InputConfig = new PublicConfigGroup(
    'input',
    '',
{
    skipDuration: {
        localizedName: 'arrow skip amount',
        type: 'number',
        description: 'Amount of time to skip by pressing the left or right arrow button when a media file is loaded, in seconds.',
        bounds: [0, null],
        default: 1
    },
    mouseScrollFactor: {
        localizedName: 'mouse scroll sensitivity',
        type: 'number',
        description: `Multiplier for scrolling speed using mouse wheel. Adjust to make scrolling speed desirable and consistent with trackpad.`,
        bounds: [0.1, 5],
        default: 1
    },
    mouseZoomFactor: {
        localizedName: 'mouse zoom sensitivity',
        type: 'number',
        description: `Multiplier for zooming speed using mouse wheel while holding Control. Adjust to make zooming speed desirable and consistent with trackpad.`,
        bounds: [0.01, 0.1],
        default: 0.05
    },
    trackpadScrollFactor: {
        localizedName: 'trackpad scroll sensitivity',
        type: 'number',
        description: `Multiplier for scrolling speed using trackpad (typically two-finger swiping). Adjust to make scrolling speed desirable and consistent with mouse wheel.`,
        bounds: [1, 50],
        default: 10
    },
    trackpadZoomFactor: {
        localizedName: 'trackpad zoom sensitivity',
        type: 'number',
        description: `A multiplier for zooming speed using trackpad (typically pinching). Adjust to make zooming speed desirable and consistent with mouse wheel.`,
        bounds: [0.1, 5],
        default: 1
    },
});
MainConfig.addGroup('input', InputConfig);

export const DebugConfig = new PublicConfigGroup(
    'debug',
    `⚠️ Advanced options for debug purpose only. You shouldn't change them unless you know what your're doing.`,
{
    disableWaveform: {
        localizedName: 'disable waveform in timeline',
        type: 'boolean',
        default: false
    },
    disableVideo: {
        localizedName: 'disable video rendering',
        type: 'boolean',
        default: false
    },
    redirectLogs: {
        localizedName: 'redirect native log to devtools',
        type: 'boolean',
        default: false
    },
    disableTry: {
        localizedName: 'disable try-guards',
        type: 'boolean',
        default: false
    },
});
MainConfig.addGroup('debug', DebugConfig);

export type TranslatedWheelEvent = {
    isZoom: true;
    amount: number,
    isTrackpad: boolean
} | {
    isZoom: false;
    amountX: number,
    amountY: number,
    isTrackpad: boolean
}

export function assert(val: boolean): asserts val {
    console.assert(val);
    if (!val) throw new Error('assertion failed');
}

export function never(x: never): never {
    throw new Error(`should be never: ${x}`);
}

export const Basic = {
    OSType: os.type(),
    pathSeparator: path.sep(),
    ctrlKey: () => Basic.OSType == 'macos' ? 'Meta' : 'Control',

    getFilename(p: string) { 
        return p.split(Basic.pathSeparator).at(-1);
    },

    escapeRegexp(str: string) {
        return str.replace(/[/\-\\^$*+?.()|[\]{}]/g, '\\$&');
    },

    splitPrintingWords(str: string): string[] {
        return str.split(/(\n)/u).flatMap((x) => x.split(
            /(?<=[^\u4E00-\u9FFF])(?=[\u4E00-\u9FFF])|(?<= )|(?<=[\u4E00-\u9FFF])(?=[\u0000-\u00FF\u4E00-\u9FFF])/u));
    },

    timeout<T>(t: number, p: Promise<T>): Promise<T> {
        return Promise.race([p, 
            new Promise<T>((_, reject) => setTimeout(() => reject('timeout'), t))]);
    },

    wait(n: number) {
        return new Promise<void>((resolve) => setTimeout(() => resolve(), n));
    },

    waitUntil(cond: () => boolean): Promise<void> {
        return new Promise((resolve) => {
            const wait = () => {
                if (cond()) resolve();
                else setTimeout(wait, 1);
            };
            wait();
        });
    },

    translateWheelEvent(e: WheelEvent): TranslatedWheelEvent {
        if (e.ctrlKey) {
            // zoom. only look at Y
            const isTrackpad = e.deltaY % 1 != 0;
            return {
                isZoom: true,
                isTrackpad,
                amount: e.deltaY * (isTrackpad 
                    ? InputConfig.data.trackpadZoomFactor
                    : InputConfig.data.mouseZoomFactor)
            };
        } else if (Math.abs(e.deltaX) < 100 && Math.abs(e.deltaY) < 100) {
            // trackpad scroll
            return {
                isZoom: false,
                isTrackpad: true,
                amountX: e.deltaX * InputConfig.data.trackpadScrollFactor,
                amountY: e.deltaY * InputConfig.data.trackpadScrollFactor,
            };
        } else {
            // mouse scroll
            return {
                isZoom: false,
                isTrackpad: false,
                amountX: e.deltaX * InputConfig.data.mouseScrollFactor,
                amountY: e.deltaY * InputConfig.data.mouseScrollFactor,
            };
        }
    }
}