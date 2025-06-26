console.info('Actions loading');

import { Menu } from "@tauri-apps/api/menu";
import { Editing } from "./Editing";

import { unwrapFunctionStore, _ } from 'svelte-i18n';
import { BasicCommands } from "./Commands";
import { DialogCommands } from "./Dialogs";
const $_ = unwrapFunctionStore(_);

export const Actions = {
    async contextMenu() {
        const selection = Editing.getSelection();
        if (selection.length == 0) return;

        let menu = await Menu.new({items: [
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
            BasicCommands.combineIntoOneEntry.toMenuItem(),
            BasicCommands.splitChannels.toMenuItem(),
            BasicCommands.connectMenu.toMenuItem(),
            { item: 'Separator' },
            BasicCommands.label.toMenuItem(),
            { item: 'Separator' },
            {
                text: $_('cxtmenu.utilities'),
                items: [
                    BasicCommands.transformTimes.toMenuItem(),
                    { item: 'Separator' },
                    BasicCommands.sortSelectionByTime.toMenuItem(),
                    { item: 'Separator' },
                    BasicCommands.createChannel.toMenuItem(),
                    BasicCommands.replaceChannel.toMenuItem(),
                    BasicCommands.exchangeChannel.toMenuItem(),
                    BasicCommands.mergeChannel.toMenuItem(),
                    BasicCommands.removeChannel.toMenuItem(),
                    BasicCommands.removeNewlines.toMenuItem(),
                    BasicCommands.removeBlankChannels.toMenuItem(),
                    { item: 'Separator' },
                    BasicCommands.mergeDuplicates.toMenuItem(),
                    DialogCommands.combineDialog.toMenuItem(),
                    DialogCommands.splitDialog.toMenuItem(),
                    BasicCommands.fixOverlap.toMenuItem(),
                ]
            },
        ]});
        menu.popup();
    }
}