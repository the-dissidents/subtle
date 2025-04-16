console.info('Actions loading');

import { Menu } from "@tauri-apps/api/menu";
import { Editing } from "./Editing";

import { unwrapFunctionStore, _ } from 'svelte-i18n';
import { Commands } from "./Commands";
const $_ = unwrapFunctionStore(_);

export const Actions = {
    async contextMenu() {
        const selection = Editing.getSelection();
        if (selection.length == 0) return;

        let menu = await Menu.new({items: [
            Commands.copyMenu.toMenuItem(),
            Commands.copyChannelText.toMenuItem(),
            Commands.cut.toMenuItem(),
            Commands.paste.toMenuItem(),
            { item: 'Separator' },
            Commands.deleteSelection.toMenuItem(),
            { item: 'Separator' },
            Commands.selectAll.toMenuItem(),
            Commands.selectByChannel.toMenuItem(),
            Commands.invertSelection.toMenuItem(),
            { item: 'Separator' },
            Commands.insertBeforeFocus.toMenuItem(),
            Commands.insertAfterFocus.toMenuItem(),
            Commands.moveMenu.toMenuItem(),
            { item: 'Separator' },
            Commands.combineIntoOneEntry.toMenuItem(),
            Commands.splitChannels.toMenuItem(),
            Commands.connectMenu.toMenuItem(),
            { item: 'Separator' },
            Commands.label.toMenuItem(),
            { item: 'Separator' },
            {
                text: $_('cxtmenu.utilities'),
                items: [
                    Commands.transformTimes.toMenuItem(),
                    { item: 'Separator' },
                    Commands.sortSelectionByTime.toMenuItem(),
                    { item: 'Separator' },
                    Commands.createChannel.toMenuItem(),
                    Commands.replaceChannel.toMenuItem(),
                    Commands.exchangeChannel.toMenuItem(),
                    Commands.removeChannel.toMenuItem(),
                    Commands.removeBlankChannels.toMenuItem(),
                    { item: 'Separator' },
                    Commands.mergeDuplicates.toMenuItem(),
                    Commands.combineDialog.toMenuItem(),
                    Commands.splitDialog.toMenuItem(),
                    Commands.fixOverlap.toMenuItem(),
                ]
            },
        ]});
        menu.popup();
    }
}