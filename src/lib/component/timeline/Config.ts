
import { _ } from 'svelte-i18n';
import { get } from "svelte/store";
import { PublicConfigGroup } from '../../config/PublicConfig.svelte';

export const TimelineConfig = new PublicConfigGroup(
  () => get(_)('config.timeline'),
  null, 1,
{
  fontSize: {
    localizedName: () => get(_)('config.font-size'),
    type: 'number',
    bounds: [5, null],
    default: 12
  },
  waveformResolution: {
    localizedName: () => get(_)('config.waveform-resolution'),
    description: () => get(_)('config.waveform-resolution-d'),
    type: 'number',
    bounds: [50, 800],
    default: 700
  },
  dragResizeArea: {
    localizedName: () => get(_)('config.resize-area-size'),
    type: 'number',
    description: () => get(_)('config.resize-area-size-d'),
    bounds: [1, 10],
    default: 5
  },
  // enableSnap: {
  //   localizedName: () => get(_)('config.snapping'),
  //   type: 'boolean',
  //   description: () => get(_)('config.snapping-d'),
  //   default: true
  // },
  snapDistance: {
    localizedName: () => get(_)('config.snap-distance'),
    type: 'number',
    description: () => get(_)('config.snap-distance-d'),
    bounds: [1, 10],
    default: 5
  },
  multiselectDragReference: {
    localizedName: () => get(_)('config.multiselect-drag-reference'),
    type: 'dropdown',
    options: {
      whole: { localizedName: () => get(_)('config.whole-of-selection') },
      eachStyleofWhole: { localizedName: () => get(_)('config.each-style-of-selection') },
      one: { localizedName: () => get(_)('config.the-entry-under-the-mouse') }
    },
    default: 'eachStyleofWhole'
  },
  showDebug: {
    localizedName: () => get(_)('config.show-debug-info'),
    type: 'boolean',
    default: true
  },
});