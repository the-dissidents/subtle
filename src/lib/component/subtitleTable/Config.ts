import { _ } from "svelte-i18n";
import { get } from 'svelte/store';
import { PublicConfigGroup } from "../../config/PublicConfig.svelte";

export const TableConfig = new PublicConfigGroup(
  () => get(_)('config.table-view'),
  null, 1,
{
  maxZoom: {
    localizedName: () => get(_)('config.maximum-zoom'),
    type: 'number',
    description: () => get(_)('config.maximum-zoom-d'),
    bounds: [1, 6],
    default: 2
  },
  autoScrollSpeed: {
    localizedName: () => get(_)('config.auto-scroll-factor'),
    type: 'number',
    description: () => get(_)('config.auto-scroll-factor-d'),
    bounds: [1, 5],
    default: 2
  },
  autoScrollExponent: {
    localizedName: () => get(_)('config.auto-scroll-exponent'),
    type: 'number',
    description: () => get(_)('config.auto-scroll-exponent-d'),
    bounds: [1, 2],
    default: 1.5
  },
  doubleClickStartEdit: {
    localizedName: () => get(_)('config.double-click-starts-edit'),
    type: 'boolean',
    default: true
  },
  doubleClickPlaybackBehavior: {
    localizedName: () => get(_)('config.double-click-playback-behavior.name'),
    type: 'dropdown',
    options: {
      none: {
        localizedName: () => get(_)('config.double-click-playback-behavior.none')
      },
      seek: {
        localizedName: () => get(_)('config.double-click-playback-behavior.seek')
      },
      play: {
        localizedName: () => get(_)('config.double-click-playback-behavior.play')
      }
    },
    default: 'seek'
  },
  showDebug: {
    localizedName: () => get(_)('config.show-debug-info'),
    type: 'boolean',
    default: false
  },
});