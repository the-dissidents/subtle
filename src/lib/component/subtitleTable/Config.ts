import { PublicConfigGroup } from "../../config/PublicConfig.svelte";
import { InputConfig } from "../../config/Groups";
import { UICommand } from "../../frontend/CommandBase";
import { Editing, SelectMode, KeepInViewMode } from "../../frontend/Editing";
import { CommandBinding, KeybindingManager } from "../../frontend/Keybinding";

import { _, unwrapFunctionStore } from 'svelte-i18n';
import { Utils } from "../../frontend/Utils";
import { ChangeCause } from "../../frontend/Source";
const $_ = unwrapFunctionStore(_);

export const TableConfig = new PublicConfigGroup(
  () => $_('config.table-view'),
  null, 1,
{
  maxZoom: {
    localizedName: () => $_('config.maximum-zoom'),
    type: 'number',
    description: () => $_('config.maximum-zoom-d'),
    bounds: [1, 6],
    default: 2
  },
  autoScrollSpeed: {
    localizedName: () => $_('config.auto-scroll-factor'),
    type: 'number',
    description: () => $_('config.auto-scroll-factor-d'),
    bounds: [1, 5],
    default: 2
  },
  autoScrollExponent: {
    localizedName: () => $_('config.auto-scroll-exponent'),
    type: 'number',
    description: () => $_('config.auto-scroll-exponent-d'),
    bounds: [1, 2],
    default: 1.5
  },
  doubleClickStartEdit: {
    localizedName: () => $_('config.double-click-starts-edit'),
    type: 'boolean',
    default: true
  },
  doubleClickPlaybackBehavior: {
    localizedName: () => $_('config.double-click-playback-behavior.name'),
    type: 'dropdown',
    options: {
      none: {
        localizedName: () => $_('config.double-click-playback-behavior.none')
      },
      seek: {
        localizedName: () => $_('config.double-click-playback-behavior.seek')
      },
      play: {
        localizedName: () => $_('config.double-click-playback-behavior.play')
      }
    },
    default: 'seek'
  },
  showDebug: {
    localizedName: () => $_('config.show-debug-info'),
    type: 'boolean',
    default: false
  },
});

export const TableCommands = {
    previousEntrySingle: new UICommand(() => $_('category.table'),
        [ CommandBinding.from(['ArrowUp'], ['Table']),
          CommandBinding.from(['Alt+ArrowUp']), ],
    {
        name: () => $_('action.previous-entry-single'),
        call: () => Editing.offsetFocus(-1, SelectMode.Single, 
            InputConfig.data.arrowNavigationType == 'keepPosition' 
            ? KeepInViewMode.SamePosition 
            : KeepInViewMode.KeepInSight)
    }),
    previousEntrySequence: new UICommand(() => $_('category.table'),
        [ CommandBinding.from(['Shift+ArrowUp'], ['Table']),
          CommandBinding.from(['Alt+Shift+ArrowUp']), ],
    {
        name: () => $_('action.previous-entry-sequence'),
        call: () => Editing.offsetFocus(-1, SelectMode.Sequence, 
            InputConfig.data.arrowNavigationType == 'keepPosition' 
            ? KeepInViewMode.SamePosition 
            : KeepInViewMode.KeepInSight)
    }),
    nextEntrySingle: new UICommand(() => $_('category.table'),
        [ CommandBinding.from(['ArrowDown'], ['Table']),
          CommandBinding.from(['Alt+ArrowDown']), ],
    {
        name: () => $_('action.next-entry-single'),
        call: () => Editing.offsetFocus(1, SelectMode.Single, 
            InputConfig.data.arrowNavigationType == 'keepPosition' 
            ? KeepInViewMode.SamePosition 
            : KeepInViewMode.KeepInSight)
    }),
    nextEntrySequence: new UICommand(() => $_('category.table'),
        [ CommandBinding.from(['Shift+ArrowDown'], ['Table']),
          CommandBinding.from(['Alt+Shift+ArrowDown']), ],
    {
        name: () => $_('action.next-entry-sequence'),
        call: () => Editing.offsetFocus(1, SelectMode.Sequence, 
            InputConfig.data.arrowNavigationType == 'keepPosition' 
            ? KeepInViewMode.SamePosition 
            : KeepInViewMode.KeepInSight)
    }),

    previousEntryWithThisStyle: new UICommand(() => $_('category.table'),
        [ CommandBinding.from(['Shift+CmdOrCtrl+ArrowUp'], ['Table']),
          CommandBinding.from(['Shift+CmdOrCtrl+Alt+ArrowUp']), ],
    {
        name: () => $_('action.previous-entry-with-this-style'),
        call: () => {
          const entry = Utils.getAdjecentEntryWithThisStyle('previous');
          if (!entry) return;
          Editing.selectEntry(entry, SelectMode.Single, ChangeCause.UIList, 
              InputConfig.data.enterNavigationType == 'keepPosition' 
              ? KeepInViewMode.SamePosition 
              : KeepInViewMode.KeepInSight);
        }
    }),
    nextEntryWithThisStyle: new UICommand(() => $_('category.table'),
        [ CommandBinding.from(['Shift+CmdOrCtrl+ArrowDown'], ['Table']),
          CommandBinding.from(['Shift+CmdOrCtrl+Alt+ArrowDown']), ],
    {
        name: () => $_('action.next-entry-with-this-style'),
        call: () => {
          const entry = Utils.getAdjecentEntryWithThisStyle('next');
          if (!entry) return;
          Editing.selectEntry(entry, SelectMode.Single, ChangeCause.UIList, 
              InputConfig.data.enterNavigationType == 'keepPosition' 
              ? KeepInViewMode.SamePosition 
              : KeepInViewMode.KeepInSight);
        }
    }),
}
KeybindingManager.register(TableCommands);