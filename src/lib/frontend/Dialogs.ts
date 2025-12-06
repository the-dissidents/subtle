console.info('Dialogs loading');

import { UICommand } from "./CommandBase";
import { KeybindingManager } from "./Keybinding";
import { Editing } from "./Editing";

import { _, unwrapFunctionStore } from 'svelte-i18n';
import { openDialog } from "../DialogOutlet.svelte";
import { Dialog } from "../dialog";
const $_ = unwrapFunctionStore(_);

export class DialogHandler<TInput = void, TOutput = string> {
    showModal?: (i: TInput) => Promise<TOutput>;
}

export const DialogCommands = {
    openConfiguration: new UICommand(() => $_('category.system'),
        [ ],
    {
        name: () => $_('menu.configuration'),
        isDialog: true,
        call: () => openDialog(Dialog.configuration)
    }),
    openKeybinding: new UICommand(() => $_('category.system'),
        [ ],
    {
        name: () => $_('menu.keybinding'),
        isDialog: true,
        call: () => openDialog(Dialog.keybinding)
    }),
    combineDialog: new UICommand(() => $_('category.tool'),
        [],
    {
        name: () => $_('action.combine-by-matching-time'),
        isDialog: true,
        isApplicable: () => Editing.getSelection().length > 0,
        call: () => openDialog(Dialog.combine)
    }),
    splitDialog: new UICommand(() => $_('category.tool'),
        [],
    {
        name: () => $_('action.split-by-line'),
        isDialog: true,
        isApplicable: () => Editing.getSelection().length > 0,
        call: () => openDialog(Dialog.splitByLine)
    }),
}
KeybindingManager.register(DialogCommands);