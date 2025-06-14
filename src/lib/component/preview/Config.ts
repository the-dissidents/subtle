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
        default: 1
    },
    maxZoom: {
        localizedName: () => $_('config.maximum-zoom'),
        type: 'number',
        description: () => $_('config.maximum-zoom-d'),
        bounds: [1, 6],
        default: 3
    },
    showDebug: {
        localizedName: () => $_('config.show-debug-info'),
        type: 'boolean',
        default: true
    }
});
