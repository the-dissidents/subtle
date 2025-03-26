import { TableConfig } from "../SubtitleTable.svelte";
import { TimelineConfig } from "../Timeline";
import { MediaConfig } from "../VideoPlayer";
import { PublicConfig, PublicConfigGroup } from "./PublicConfig.svelte";

import { unwrapFunctionStore, _, locale } from 'svelte-i18n';
const $_ = unwrapFunctionStore(_);

export const MainConfig = new PublicConfig('main');

export const InterfaceConfig = new PublicConfigGroup(
    () => $_('config.interface'),
    null, 0,
    {
        language: {
            localizedName: () => $_('config.language'),
            type: 'dropdown',
            description: () => $_('not-implemented-yet'),
            options: {
                en: { localizedName: () => 'English' },
                'zh-cn': { localizedName: () => '简体中文' },
            },
            default: 'en'
        },
        theme: {
            localizedName: () => $_('config.theme'),
            type: 'select',
            description: () => $_('not-implemented-yet'),
            options: {
                light: {
                    localizedName: () => $_('config.light')
                },
                dark: {
                    localizedName: () => $_('config.dark')
                },
                auto: {
                    localizedName: () => $_('config.use-system-theme')
                }
            },
            default: 'light'
        },
        fontSize: {
            localizedName: () => $_('config.ui-font-size'),
            type: 'number',
            bounds: [5, null],
            default: 14
        },
        fontFamily: {
            localizedName: () => $_('config.ui-font-family'),
            type: 'string',
            default: 'Arial, Helvetica, sans-serif'
        }
    });
MainConfig.addGroup('interface', InterfaceConfig);

export const InputConfig = new PublicConfigGroup(
    () => $_('config.input'),
    null, 2,
    {
        skipDuration: {
            localizedName: () => $_('config.arrow-skip-amount'),
            type: 'number',
            description: () => $_('config.arrow-skip-amount-d'),
            bounds: [0, null],
            default: 1
        },
        mouseScrollFactor: {
            localizedName: () => $_('config.mouse-scroll-sensitivity'),
            type: 'number',
            description: () => $_('config.mouse-scroll-sensitivity-d'),
            bounds: [0.1, 5],
            default: 1
        },
        mouseZoomFactor: {
            localizedName: () => $_('config.mouse-zoom-sensitivity'),
            type: 'number',
            description: () => $_('config.mouse-zoom-sensitivity-d'),
            bounds: [0.01, 0.1],
            default: 0.05
        },
        trackpadScrollFactor: {
            localizedName: () => $_('config.trackpad-scroll-sensitivity'),
            type: 'number',
            description: () => $_('config.trackpad-scroll-sensitivity-d'),
            bounds: [1, 50],
            default: 10
        },
        trackpadZoomFactor: {
            localizedName: () => $_('config.trackpad-zoom-sensitivity'),
            type: 'number',
            description: () => $_('config.trackpad-zoom-sensitivity-d'),
            bounds: [0.1, 5],
            default: 1
        },
    });
MainConfig.addGroup('input', InputConfig);

export const DebugConfig = new PublicConfigGroup(
    () => $_('config.debug'),
    () => $_('config.debug-d'), 10,
    {
        disableWaveform: {
            localizedName: () => 'disable waveform in timeline',
            type: 'boolean',
            default: false
        },
        disableVideo: {
            localizedName: () => 'disable video rendering',
            type: 'boolean',
            default: false
        },
        redirectLogs: {
            localizedName: () => 'redirect native log to devtools',
            type: 'boolean',
            description: () => $_('not-implemented-yet'),
            default: false
        },
        disableTry: {
            localizedName: () => 'disable try-guards',
            type: 'boolean',
            default: false
        },
        mouseWheelDetection: {
            localizedName: () => 'mouse wheel detection method',
            type: 'dropdown',
            options: {
                threshold: { localizedName: () => 'delta >= 100' },
                multiple: { localizedName: () => 'delta is multiple of 120' }
            },
            default: 'multiple'
        }
    });
MainConfig.addGroup('debug', DebugConfig);

MainConfig.addGroup('timeline', TimelineConfig);
MainConfig.addGroup('media', MediaConfig);
MainConfig.addGroup('table', TableConfig);