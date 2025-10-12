
import { get } from "svelte/store";
import { PublicConfigGroup } from '../../config/PublicConfig.svelte';
import { UICommand } from '../../frontend/CommandBase';
import { Editing } from '../../frontend/Editing';
import { CommandBinding, KeybindingManager } from '../../frontend/Keybinding';
import { Debug } from '../../Debug';
import { EventHost } from '../../details/EventHost';
import { Playback } from '../../frontend/Playback';
import { ChangeType, Source } from '../../frontend/Source';

import { _, unwrapFunctionStore } from 'svelte-i18n';
import { SubtitleEntry, type SubtitleStyle } from "../../core/Subtitles.svelte";
import { TimelineHandle } from "./Input.svelte";
import { MediaPlayerInterface2 } from "../preview/MediaPlayer2";
const $_ = unwrapFunctionStore(_);

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
    dragSeamArea: {
        localizedName: () => get(_)('config.seam-area-size'),
        type: 'number',
        description: () => get(_)('config.seam-area-size-d'),
        bounds: [1, 15],
        default: 2
    },
    dragResizeArea: {
        localizedName: () => get(_)('config.resize-area-size'),
        type: 'number',
        description: () => get(_)('config.resize-area-size-d'),
        bounds: [1, 15],
        default: 6
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

async function make<T>(other: UICommand<T>) {
    if (other.activated)
        await other.end();
    const style = Source.subs.view.timelineActiveChannel;
    Debug.assert(style !== null);
    const pos = Playback.position;
    const entry = Editing.insertAtTime(pos, pos, style);
    MediaPlayerInterface2.onPlayback.bind(entry, 
        (newpos) => { entry.end = Math.max(entry.end, newpos) });
    return [entry, style] as const;
}

export const TimelineCommands = {
    holdToCreateEntry1: new UICommand(() => $_('category.timeline'),
        [ CommandBinding.from(['J'], ['Timeline']) ],
    {
        name: () => $_('action.hold-to-create-entry-1'),
        isApplicable: () => Playback.isPlaying 
            && Source.subs.view.timelineActiveChannel !== null,
        call: (): Promise<readonly [SubtitleEntry, SubtitleStyle]> => 
            make(TimelineCommands.holdToCreateEntry2),
        onDeactivate: ([entry, style]) => {
            EventHost.unbind(entry);
            if (get(Editing.useUntimedForNewEntires))
                Editing.fillWithFirstLineOfUntimed(entry, style);
            Source.markChanged(ChangeType.Times, $_('c.hold-to-create-entry'));
        }
    }),
    holdToCreateEntry2: new UICommand(() => $_('category.timeline'),
        [ CommandBinding.from(['K'], ['Timeline']) ],
    {
        name: () => $_('action.hold-to-create-entry-2'),
        isApplicable: () => Playback.isPlaying 
            && Source.subs.view.timelineActiveChannel !== null,
        call: (): Promise<readonly [SubtitleEntry, SubtitleStyle]> => 
            make(TimelineCommands.holdToCreateEntry1),
        onDeactivate: ([entry, style]) => {
            EventHost.unbind(entry);
            if (get(Editing.useUntimedForNewEntires))
                Editing.fillWithFirstLineOfUntimed(entry, style);
            Source.markChanged(ChangeType.Times, $_('c.hold-to-create-entry'));
        }
    }),
    moveWholeStartTo: new UICommand(() => $_('category.timeline'),
        [ CommandBinding.from(['CmdOrCtrl+['], ['Timeline']) ],
    {
        name: () => $_('action.move-whole-start-time-to-cursor'),
        isApplicable: () => Editing.getSelection().length > 0,
        call: () => {
            const selection = Editing.getSelection();
            const start = Math.min(...selection.map((x) => x.start));
            const delta = start - Playback.position;
            selection.forEach((x) => {
                x.start -= delta;
                x.end -= delta;
            });
            Source.markChanged(ChangeType.Times, $_('action.move-whole-start-time-to-cursor'));
        }
    }),
    moveWholeEndTo: new UICommand(() => $_('category.timeline'),
        [ CommandBinding.from(['CmdOrCtrl+]'], ['Timeline']) ],
    {
        name: () => $_('action.move-whole-end-time-to-cursor'),
        isApplicable: () => Editing.getSelection().length > 0,
        call: () => {
            const selection = Editing.getSelection();
            const end = Math.max(...selection.map((x) => x.end));
            const delta = end - Playback.position;
            selection.forEach((x) => {
                x.end -= delta;
                x.end -= delta;
            });
            Source.markChanged(ChangeType.Times, $_('action.move-whole-end-time-to-cursor'));
        }
    }),
    setStart: new UICommand(() => $_('category.timeline'),
        [ CommandBinding.from(['['], ['Timeline']) ],
    {
        name: () => $_('action.set-start-time-to-cursor'),
        isApplicable: () => Editing.getFocusedEntry() instanceof SubtitleEntry,
        call: () => {
            const focus = Editing.getFocusedEntry();
            Debug.assert(focus instanceof SubtitleEntry);
            if (focus.end > Playback.position) {
                focus.start = Playback.position;
                Source.markChanged(ChangeType.Times, $_('action.set-start-time-to-cursor'));
            }
        }
    }),
    setEnd: new UICommand(() => $_('category.timeline'),
        [ CommandBinding.from([']'], ['Timeline']) ],
    {
        name: () => $_('action.set-end-time-to-cursor'),
        isApplicable: () => Editing.getFocusedEntry() instanceof SubtitleEntry,
        call: () => {
            const focus = Editing.getFocusedEntry();
            Debug.assert(focus instanceof SubtitleEntry);
            if (focus.start < Playback.position) {
                focus.end = Playback.position;
                Source.markChanged(ChangeType.Times, $_('action.set-end-time-to-cursor'));
            }
        }
    }),
    selectMode: new UICommand(() => $_('category.timeline'),
        [ CommandBinding.from(['A'], ['Timeline']) ],
    {
        name: () => $_('action.open-select-tool'),
        call: () => TimelineHandle.currentMode.set('select')
    }),
    createMode: new UICommand(() => $_('category.timeline'),
        [ CommandBinding.from(['D'], ['Timeline']) ],
    {
        name: () => $_('action.open-create-tool'),
        call: () => TimelineHandle.currentMode.set('create')
    }),
    splitMode: new UICommand(() => $_('category.timeline'),
        [ CommandBinding.from(['C'], ['Timeline']) ],
    {
        name: () => $_('action.open-split-tool'),
        call: () => TimelineHandle.currentMode.set('split')
    }),
};
KeybindingManager.register(TimelineCommands);