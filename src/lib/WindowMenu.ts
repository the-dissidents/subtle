import { Menu, Submenu } from "@tauri-apps/api/menu";

import { unwrapFunctionStore, _ } from 'svelte-i18n';
import { InterfaceCommands } from "./frontend/Interface";
import { BasicCommands } from "./frontend/Commands";
import { DialogCommands } from "./frontend/Dialogs";
import { PlaybackCommands } from "./frontend/Playback";
const $_ = unwrapFunctionStore(_);

let appMenu: Menu;
let originalMenu: Menu | null;

export async function initWindowMenu() {
    const file = await Submenu.new({
        text: $_('appmenu.file'),
        items: [
            InterfaceCommands.newFile.toMenuItem(),
            { item: 'Separator' },
            InterfaceCommands.openMenu.toMenuItem(),
            InterfaceCommands.import.toMenuItem(),
            { item: 'Separator' },
            InterfaceCommands.openVideo.toMenuItem(),
            InterfaceCommands.closeVideo.toMenuItem(),
            { item: 'Separator' },
            InterfaceCommands.save.toMenuItem(),
            InterfaceCommands.saveAs.toMenuItem(),
            InterfaceCommands.exportMenu.toMenuItem(),
        ]
    });
    const entries = await Submenu.new({
        text: $_('appmenu.entries'),
        items: [
            BasicCommands.copyMenu.toMenuItem(),
            BasicCommands.copyChannelText.toMenuItem(),
            BasicCommands.cut.toMenuItem(),
            BasicCommands.paste.toMenuItem(),
            { item: 'Separator' },
            BasicCommands.deleteSelection.toMenuItem(),
            { item: 'Separator' },
            BasicCommands.selectAll.toMenuItem(),
            BasicCommands.selectByChannel.toMenuItem(),
            BasicCommands.invertSelection.toMenuItem(),
            { item: 'Separator' },
            BasicCommands.insertBeforeFocus.toMenuItem(),
            BasicCommands.insertAfterFocus.toMenuItem(),
            BasicCommands.moveMenu.toMenuItem(),
            { item: 'Separator' },
            BasicCommands.connectMenu.toMenuItem(),
        ]
    });
    const channels = await Submenu.new({
        text: $_('cxtmenu.channels'),
        items: [
            BasicCommands.combineIntoOneEntry.toMenuItem(),
            BasicCommands.splitChannels.toMenuItem(),
            { item: 'Separator' },
            BasicCommands.createChannel.toMenuItem(),
            BasicCommands.replaceChannel.toMenuItem(),
            BasicCommands.exchangeChannel.toMenuItem(),
            BasicCommands.mergeChannel.toMenuItem(),
            BasicCommands.removeChannel.toMenuItem(),
            BasicCommands.removeNewlines.toMenuItem(),
            BasicCommands.removeFormatting.toMenuItem(),
            BasicCommands.removeBlankChannels.toMenuItem(),
        ]
    });
    const utilities = await Submenu.new({
        text: $_('cxtmenu.utilities'),
        items: [
            BasicCommands.transformTimes.toMenuItem(),
            { item: 'Separator' },
            BasicCommands.sortSelectionByTime.toMenuItem(),
            BasicCommands.sortSelectionByLabel.toMenuItem(),
            { item: 'Separator' },
            BasicCommands.mergeDuplicates.toMenuItem(),
            DialogCommands.combineDialog.toMenuItem(),
            DialogCommands.splitDialog.toMenuItem(),
            BasicCommands.fixOverlap.toMenuItem(),
        ]
    });
    const playback = await Submenu.new({
        text: $_('cxtmenu.playback'),
        items: [
            PlaybackCommands.togglePlay.toMenuItem(),
            { item: 'Separator' },
            PlaybackCommands.nextFrame.toMenuItem(),
            PlaybackCommands.previousFrame.toMenuItem(),
            PlaybackCommands.jumpBackward.toMenuItem(),
            PlaybackCommands.jumpForward.toMenuItem(),
            { item: 'Separator' },
            PlaybackCommands.selectAudioStream.toMenuItem(),
        ]
    });
    const system = await Submenu.new({
        text: $_('appmenu.system'),
        items: [
            DialogCommands.openConfiguration.toMenuItem(),
            DialogCommands.openKeybinding.toMenuItem(),
            DialogCommands.reportBugs.toMenuItem(),
        ]
    });

    const first = (await (await Menu.default()).items())[0];

    appMenu = await Menu.new({
        items: [first, file, entries, channels, utilities, playback, system]
    });
    const old = await appMenu.setAsAppMenu();
    if (!originalMenu) originalMenu = old;
}