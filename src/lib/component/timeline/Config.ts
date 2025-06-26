
import { get } from "svelte/store";
import { PublicConfigGroup } from '../../config/PublicConfig.svelte';
import { UICommand } from '../../frontend/CommandBase';
import { Editing } from '../../frontend/Editing';
import { CommandBinding, KeybindingManager } from '../../frontend/Keybinding';
import { Debug } from '../../Debug';
import { EventHost } from '../../details/EventHost';
import { Playback } from '../../frontend/Playback';
import { ChangeType, Source } from '../../frontend/Source';
import { MediaPlayerInterface } from '../preview/MediaPlayer';
import { TimelineParams } from './Timeline.svelte';

import { _, unwrapFunctionStore } from 'svelte-i18n';
import type { SubtitleEntry } from "../../core/Subtitles.svelte";
export const $_ = unwrapFunctionStore(_);

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
    showKeyframes: {
        localizedName: () => get(_)('config.show-keyframes'),
        type: 'boolean',
        description: () => get(_)('config.show-keyframes-d'),
        default: true
    },
    dragResizeArea: {
        localizedName: () => get(_)('config.resize-area-size'),
        type: 'number',
        description: () => get(_)('config.resize-area-size-d'),
        bounds: [1, 10],
        default: 5
    },
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

async function make(other: UICommand<any>) {
    if (other.activated)
        await other.end();
    Debug.assert(TimelineParams.activeChannel !== undefined);
    const pos = Playback.position;
    const entry = Editing.insertAtTime(pos, pos, TimelineParams.activeChannel);
    MediaPlayerInterface.onPlayback.bind(entry, 
        (newpos) => { entry.end = Math.max(entry.end, newpos) });
    return entry;
}

export const TimelineCommands = {
    holdToCreateEntry1: new UICommand(() => $_('category.timeline'),
        [ CommandBinding.from(['J'], ['Timeline']) ],
    {
        name: () => $_('action.hold-to-create-entry-1'),
        isApplicable: () => Playback.isPlaying && TimelineParams.activeChannel !== null,
        call: (): Promise<SubtitleEntry> => make(TimelineCommands.holdToCreateEntry2),
        onDeactivate: (entry) => {
            EventHost.unbind(entry);
            Source.markChanged(ChangeType.Times);
        }
    }),
    holdToCreateEntry2: new UICommand(() => $_('category.timeline'),
        [ CommandBinding.from(['K'], ['Timeline']) ],
    {
        name: () => $_('action.hold-to-create-entry-2'),
        isApplicable: () => Playback.isPlaying && TimelineParams.activeChannel !== null,
        call: (): Promise<SubtitleEntry> => make(TimelineCommands.holdToCreateEntry1),
        onDeactivate: (entry) => {
            EventHost.unbind(entry);
            Source.markChanged(ChangeType.Times);
        }
    }),
    selectMode: new UICommand(() => $_('category.timeline'),
        [ CommandBinding.from(['A'], ['Timeline']) ],
    {
        name: () => $_('action.open-select-tool'),
        call: () => TimelineParams.currentMode = 'select'
    }),
    createMode: new UICommand(() => $_('category.timeline'),
        [ CommandBinding.from(['D'], ['Timeline']) ],
    {
        name: () => $_('action.open-create-tool'),
        call: () => TimelineParams.currentMode = 'create'
    }),
    splitMode: new UICommand(() => $_('category.timeline'),
        [ CommandBinding.from(['C'], ['Timeline']) ],
    {
        name: () => $_('action.open-split-tool'),
        call: () => TimelineParams.currentMode = 'split'
    }),
};
KeybindingManager.register(TimelineCommands);