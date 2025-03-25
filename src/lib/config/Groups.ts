import { TableConfig } from "../SubtitleTable.svelte";
import { TimelineConfig } from "../Timeline";
import { MediaConfig } from "../VideoPlayer";
import { PublicConfig, PublicConfigGroup } from "./PublicConfig.svelte";

export const MainConfig = new PublicConfig('main');

export const InterfaceConfig = new PublicConfigGroup(
    'interface',
    '', 0,
    {
        language: {
            localizedName: 'language',
            type: 'dropdown',
            description: `Not implemented yet`,
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
            description: `Not implemented yet`,
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
        },
        fontSize: {
            localizedName: 'UI font size',
            type: 'number',
            bounds: [5, null],
            default: 14
        },
        fontFamily: {
            localizedName: 'UI font family',
            type: 'string',
            default: 'Arial, Helvetica, sans-serif'
        }
    });
MainConfig.addGroup('interface', InterfaceConfig);

export const InputConfig = new PublicConfigGroup(
    'input',
    '', 2,
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
    `⚠️ Advanced options for debug purpose only. You shouldn't change them unless you know what your're doing.`, 10,
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
            description: `Not implemented yet`,
            default: false
        },
        disableTry: {
            localizedName: 'disable try-guards',
            type: 'boolean',
            default: false
        },
        mouseWheelDetection: {
            localizedName: 'mouse wheel detection method',
            type: 'dropdown',
            options: {
                threshold: { localizedName: 'delta >= 100' },
                multiple: { localizedName: 'delta is multiple of 120' }
            },
            default: 'multiple'
        }
    });
MainConfig.addGroup('debug', DebugConfig);

MainConfig.addGroup('timeline', TimelineConfig);
MainConfig.addGroup('media', MediaConfig);
MainConfig.addGroup('table', TableConfig);