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
