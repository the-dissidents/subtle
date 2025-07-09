import { Menu } from "@tauri-apps/api/menu";
import { Editing } from "../../frontend/Editing";
import { BasicCommands } from "../../frontend/Commands";
import { get } from "svelte/store";
import { _ } from "svelte-i18n";

export async function contextMenu() {
    const selection = Editing.getSelection();

    let menu = await Menu.new({items: 
        selection.length == 0
    ? [
        BasicCommands.selectAll.toMenuItem(),
        BasicCommands.selectByChannel.toMenuItem(),
    ]
    : [
        BasicCommands.copyMenu.toMenuItem(),
        BasicCommands.copyChannelText.toMenuItem(),
        BasicCommands.cut.toMenuItem(),
        { item: 'Separator' },
        BasicCommands.deleteSelection.toMenuItem(),
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
            ]
        },
        { item: 'Separator' },
        BasicCommands.label.toMenuItem(),
    ]});
    menu.popup();
}