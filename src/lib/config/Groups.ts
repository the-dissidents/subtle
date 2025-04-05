console.info('Groups loading');

import { unwrapFunctionStore, _ } from 'svelte-i18n';
import { PublicConfig, PublicConfigGroup } from "./PublicConfig.svelte";
const $_ = unwrapFunctionStore(_);

export const MainConfig = new PublicConfig('main');

export const InterfaceConfig = new PublicConfigGroup(
    () => $_('config.interface'),
    null, 0,
    {
        language: {
            localizedName: () => $_('config.language'),
            type: 'dropdown',
            options: {
                en: { localizedName: () => 'English' },
                'zh-cn': { localizedName: () => '简体中文' },
                'zh-tw': { localizedName: () => '繁體中文' },
            },
            default: 'en'
        },
        theme: {
            localizedName: () => $_('config.theme'),
            type: 'select',
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
            description: () => $_('config.ui-font-family-d'),
            default: 'Arial, Helvetica, sans-serif'
        },
        editorFontSize: {
            localizedName: () => $_('config.editor-font-size'),
            type: 'number',
            bounds: [5, null],
            default: 14
        },
        editorFontFamily: {
            localizedName: () => $_('config.editor-font-family'),
            type: 'string',
            description: () => $_('config.ui-font-family-d'),
            default: 'Arial, Helvetica, sans-serif'
        },
        minScrollerLength: {
            localizedName: () => $_('config.minimum-scroller-length'),
            type: 'number',
            description: () => $_('config.minimum-scroller-length-d'),
            bounds: [1, 200],
            default: 20
        },
        autosaveInterval: {
            localizedName: () => $_('config.autosave-interval'),
            type: 'integer',
            description: () => $_('config.autosave-interval-d'),
            bounds: [0, 60],
            default: 5
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
        arrowNavigationType: {
            localizedName: () => $_('config.arrow-navigation-type'),
            type: 'dropdown',
            description: () => $_('config.arrow-navigation-type-d'),
            options: {
                keepPosition: { localizedName: () => $_('config.navigation-keep-position') },
                keepInView: { localizedName: () => $_('config.navigation-keep-in-view') }
            },
            default: 'keepInView'
        },
        enterNavigationType: {
            localizedName: () => $_('config.enter-navigation-type'),
            type: 'dropdown',
            description: () => $_('config.enter-navigation-type-d'),
            options: {
                keepPosition: { localizedName: () => $_('config.navigation-keep-position') },
                keepInView: { localizedName: () => $_('config.navigation-keep-in-view') }
            },
            default: 'keepPosition'
        },
        mouseScrollFactor: {
            localizedName: () => $_('config.mouse-scroll-sensitivity'),
            type: 'number',
            // description: () => $_('config.mouse-scroll-sensitivity-d'),
            bounds: [0.1, 5],
            default: 1
        },
        mouseZoomFactor: {
            localizedName: () => $_('config.mouse-zoom-sensitivity'),
            type: 'number',
            // description: () => $_('config.mouse-zoom-sensitivity-d'),
            bounds: [0.005, 0.25],
            default: 0.05
        },
        trackpadScrollFactor: {
            localizedName: () => $_('config.trackpad-scroll-sensitivity'),
            type: 'number',
            // description: () => $_('config.trackpad-scroll-sensitivity-d'),
            bounds: [0.5, 25],
            default: 5
        },
        trackpadZoomFactor: {
            localizedName: () => $_('config.trackpad-zoom-sensitivity'),
            type: 'number',
            // description: () => $_('config.trackpad-zoom-sensitivity-d'),
            bounds: [0.1, 5],
            default: 1
        },
    });
MainConfig.addGroup('input', InputConfig);

export const DebugConfig = new PublicConfigGroup(
    () => $_('config.debug'),
    () => $_('config.debug-d'), 10,
    {
        persistentLogLevel: {
            localizedName: () => 'persistent log level',
            type: 'dropdown',
            options: {
                ['Off']: { localizedName: () => 'off' },
                ['Trace']: { localizedName: () => 'trace' },
                ['Debug']: { localizedName: () => 'debug' },
                ['Info']: { localizedName: () => 'info' },
                ['Warn']: { localizedName: () => 'warn' },
                ['Error']: { localizedName: () => 'error' },
            },
            default: 'Debug'
        },
        logLevel: {
            localizedName: () => 'webview log level',
            type: 'dropdown',
            options: {
                ['Off']: { localizedName: () => 'off' },
                ['Trace']: { localizedName: () => 'trace' },
                ['Debug']: { localizedName: () => 'debug' },
                ['Info']: { localizedName: () => 'info' },
                ['Warn']: { localizedName: () => 'warn' },
                ['Error']: { localizedName: () => 'error' },
            },
            default: 'Debug'
        },
        redirectLogs: {
            localizedName: () => 'redirect native log to devtools',
            type: 'boolean',
            default: true
        },
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