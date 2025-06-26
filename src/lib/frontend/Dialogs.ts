console.info('Dialogs loading');

import type { AnalyseResult, EncodingName } from "chardet";
import type { MergeOptions, TimeShiftOptions } from "../core/SubtitleUtil.svelte";
import { mount, unmount } from "svelte";
import OverlayMenu from "../ui/OverlayMenu.svelte";
import { UICommand } from "./CommandBase";
import type { CommandBinding } from "./Keybinding";
import { Editing } from "./Editing";

import { _, unwrapFunctionStore } from 'svelte-i18n';
const $_ = unwrapFunctionStore(_);

export class DialogHandler<TInput = void, TOutput = string> {
    showModal?: (i: TInput) => Promise<TOutput>;
}

export const Dialogs = {
    modalOpenCounter: 0,

    importOptions: new DialogHandler<boolean, MergeOptions | null>(),
    timeTransform: new DialogHandler<void, TimeShiftOptions | null>(),
    combine: new DialogHandler<void, void>(),
    configuration: new DialogHandler<void, void>(),
    keybinding: new DialogHandler<void, void>(),
    keybindingInput: new DialogHandler<
        [UICommand<any>, CommandBinding | null], CommandBinding | null>(),
    splitByLine: new DialogHandler<void, void>(),
    export: new DialogHandler<void, {content: string, ext: string} | null>(),
    encoding: new DialogHandler<
        {path: string, source: Uint8Array, result: AnalyseResult}, 
        {decoded: string, encoding: EncodingName} | null>(),

    overlayMenu(
        items: {text: string, disabled?: boolean}[], 
        title?: string, text?: string
    ): Promise<number> {
        return new Promise<number>((resolve) => {
            const menu = mount(OverlayMenu, {
                target: document.getElementById('app')!,
                props: { items, text, title, async onSubmit(x) {
                    await unmount(menu);
                    resolve(x);
                }, }
            });
        });
    },
}

export const DialogCommands = {
    openConfiguration: new UICommand(() => $_('category.system'),
        [ ],
    {
        name: () => $_('menu.configuration'),
        isDialog: true,
        call: () => Dialogs.configuration.showModal!()
    }),
    openKeybinding: new UICommand(() => $_('category.system'),
        [ ],
    {
        name: () => $_('menu.keybinding'),
        isDialog: true,
        call: () => Dialogs.keybinding.showModal!()
    }),
    combineDialog: new UICommand(() => $_('category.tool'),
        [],
    {
        name: () => $_('action.combine-by-matching-time'),
        isDialog: true,
        isApplicable: () => Editing.getSelection().length > 0,
        call: () => Dialogs.combine.showModal!()
    }),
    splitDialog: new UICommand(() => $_('category.tool'),
        [],
    {
        name: () => $_('action.split-by-line'),
        isDialog: true,
        isApplicable: () => Editing.getSelection().length > 0,
        call: () => Dialogs.splitByLine.showModal!()
    }),
}