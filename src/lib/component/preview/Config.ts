import { unwrapFunctionStore, _ } from "svelte-i18n";
import { PublicConfigGroup } from "../../config/PublicConfig.svelte";

const $_ = unwrapFunctionStore(_);

export const MediaConfig = new PublicConfigGroup(
    () => $_('config.media'),
    null, 1,
{
    preloadAmount: {
        localizedName: () => $_('config.preload-amount'),
        type: 'number',
        description: () => $_('config.preload-amount-d'),
        bounds: [0.1, 10],
        default: 0.2
    },
    preloadWorkTime: {
        localizedName: () => $_('config.preload-work-time'),
        type: 'integer',
        description: () => $_('config.preload-work-time-d'),
        bounds: [0, 15],
        default: 5
    },
    maxZoom: {
        localizedName: () => $_('config.maximum-zoom'),
        type: 'number',
        description: () => $_('config.maximum-zoom-d'),
        bounds: [1, 6],
        default: 3
    },
    limitFrameSize: {
        localizedName: () => $_('config.limit-frame-size'),
        type: 'number',
        description: () => $_('config.limit-frame-size-d'),
        bounds: [0, 20],
        default: 3
    },
    showBoundingBoxes: {
        localizedName: () => $_('config.show-bounding-boxes'),
        type: 'boolean',
        description: () => $_('config.show-bounding-boxes-d'),
        default: false
    },
    subtitleRenderer: {
        localizedName: () => $_('config.subtitle-renderer'),
        type: 'dropdown',
        options: {
            canvas: { localizedName: () => $_('config.subtitle-renderer-canvas') },
            dom: { localizedName: () => $_('config.subtitle-renderer-dom') },
        },
        default: 'dom'
    },
    showDebug: {
        localizedName: () => $_('config.show-debug-info'),
        type: 'boolean',
        default: true
    }
});
