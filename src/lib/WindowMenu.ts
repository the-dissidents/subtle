import { Menu, Submenu } from "@tauri-apps/api/menu";

import { unwrapFunctionStore, _ } from 'svelte-i18n';
import { InterfaceCommands } from "./frontend/Interface";
import { BasicCommands } from "./frontend/Commands";
import { DialogCommands } from "./frontend/Dialogs";
import { PlaybackCommands } from "./frontend/Playback";
import { InterfaceConfig } from "./config/Groups";
import { platform } from "@tauri-apps/plugin-os";
import { SourceCommands } from "./frontend/Source";
const $_ = unwrapFunctionStore(_);

let appMenu: Menu;
let originalMenu: Menu | null;

export async function initWindowMenu() {
    const file = await Submenu.new({
        text: $_('appmenu.file'),
        items: [
            InterfaceCommands.newFile.toGlobalMenuItem(),
            { item: 'Separator' },
            InterfaceCommands.openMenu.toGlobalMenuItem(),
            InterfaceCommands.import.toGlobalMenuItem(),
            { item: 'Separator' },
            InterfaceCommands.openVideo.toGlobalMenuItem(),
            InterfaceCommands.closeVideo.toGlobalMenuItem(),
            { item: 'Separator' },
            InterfaceCommands.save.toGlobalMenuItem(),
            InterfaceCommands.saveAs.toGlobalMenuItem(),
            InterfaceCommands.exportMenu.toGlobalMenuItem(),
            { item: 'Separator' },
            SourceCommands.undo.toGlobalMenuItem(),
            SourceCommands.redo.toGlobalMenuItem(),
        ]
    });
    const entries = await Submenu.new({
        text: $_('appmenu.entries'),
        items: [
            BasicCommands.copyMenu.toGlobalMenuItem(),
            BasicCommands.copyChannelText.toGlobalMenuItem(),
            BasicCommands.cut.toGlobalMenuItem(),
            BasicCommands.paste.toGlobalMenuItem(),
            { item: 'Separator' },
            BasicCommands.deleteSelection.toGlobalMenuItem(),
            { item: 'Separator' },
            BasicCommands.selectAll.toGlobalMenuItem(),
            BasicCommands.selectByChannel.toGlobalMenuItem(),
            BasicCommands.invertSelection.toGlobalMenuItem(),
            { item: 'Separator' },
            BasicCommands.insertBeforeFocus.toGlobalMenuItem(),
            BasicCommands.insertAfterFocus.toGlobalMenuItem(),
            BasicCommands.moveMenu.toGlobalMenuItem(),
            { item: 'Separator' },
            BasicCommands.connectMenu.toGlobalMenuItem(),
        ]
    });
    const text = await Submenu.new({
        text: $_('appmenu.text'),
        items: [
            { item: 'Separator' },
            { item: 'Cut' },
            { item: 'Copy' },
            { item: 'Paste' },
            { item: 'Separator' },
            { item: 'SelectAll' },
            { item: 'Separator' },
            { item: 'Undo' },
            { item: 'Redo' },
        ]
    });
    const channels = await Submenu.new({
        text: $_('cxtmenu.channels'),
        items: [
            BasicCommands.combineIntoOneEntry.toGlobalMenuItem(),
            BasicCommands.splitChannels.toGlobalMenuItem(),
            { item: 'Separator' },
            BasicCommands.createChannel.toGlobalMenuItem(),
            BasicCommands.replaceChannel.toGlobalMenuItem(),
            BasicCommands.exchangeChannel.toGlobalMenuItem(),
            BasicCommands.mergeChannel.toGlobalMenuItem(),
            BasicCommands.removeChannel.toGlobalMenuItem(),
            BasicCommands.removeNewlines.toGlobalMenuItem(),
            BasicCommands.removeFormatting.toGlobalMenuItem(),
            BasicCommands.removeBlankChannels.toGlobalMenuItem(),
        ]
    });
    const utilities = await Submenu.new({
        text: $_('cxtmenu.utilities'),
        items: [
            BasicCommands.transformTimes.toGlobalMenuItem(),
            { item: 'Separator' },
            BasicCommands.sortSelectionByTime.toGlobalMenuItem(),
            BasicCommands.sortSelectionByLabel.toGlobalMenuItem(),
            { item: 'Separator' },
            BasicCommands.mergeDuplicates.toGlobalMenuItem(),
            DialogCommands.combineDialog.toGlobalMenuItem(),
            DialogCommands.splitDialog.toGlobalMenuItem(),
            BasicCommands.fixOverlap.toGlobalMenuItem(),
        ]
    });
    const playback = await Submenu.new({
        text: $_('cxtmenu.playback'),
        items: [
            PlaybackCommands.togglePlay.toGlobalMenuItem(),
            { item: 'Separator' },
            PlaybackCommands.nextFrame.toGlobalMenuItem(),
            PlaybackCommands.previousFrame.toGlobalMenuItem(),
            PlaybackCommands.jumpBackward.toGlobalMenuItem(),
            PlaybackCommands.jumpForward.toGlobalMenuItem(),
            { item: 'Separator' },
            PlaybackCommands.selectAudioStream.toGlobalMenuItem(),
        ]
    });
    const system = await Submenu.new({
        text: $_('appmenu.system'),
        items: [
            DialogCommands.openConfiguration.toGlobalMenuItem(),
            DialogCommands.openKeybinding.toGlobalMenuItem(),
            DialogCommands.reportBugs.toGlobalMenuItem(),
            { item: 'Separator' },
            { item: 'Maximize' },
            { item: 'Minimize' },
        ]
    });

    const first = (await (await Menu.default()).items())[0];

    appMenu = await Menu.new({
        items: [first, file, text, entries, channels, utilities, playback, system]
    });

    if (InterfaceConfig.data.showWindowMenu || platform() == 'macos') {
        const old = await appMenu.setAsAppMenu();
        if (!originalMenu) originalMenu = old;
    }
}
