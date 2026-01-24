import { Menu } from "@tauri-apps/api/menu";
import { Editing } from "../../frontend/Editing";
import { BasicCommands } from "../../frontend/Commands";
import { get } from "svelte/store";
import { _ } from "svelte-i18n";
import { DialogCommands } from "../../frontend/Dialogs";

export async function contextMenu() {
    const selection = Editing.getSelection();
    if (selection.length == 0) return;

    const menu = await Menu.new({items: [
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
        { item: 'Separator' },
        {
            text: get(_)('cxtmenu.channels'),
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
                BasicCommands.removeBlankChannels.toMenuItem(),
                { item: 'Separator' },
                BasicCommands.removeHTMLTags.toMenuItem(),
            ]
        },
        { item: 'Separator' },
        BasicCommands.label.toMenuItem(),
        { item: 'Separator' },
        {
            text: get(_)('cxtmenu.utilities'),
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
        },
    ]});
    menu.popup();
}