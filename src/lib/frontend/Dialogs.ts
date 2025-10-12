console.info('Dialogs loading');

import { UICommand } from "./CommandBase";
import type { AnalyseResult, EncodingName } from "chardet";
import type { MergeOptions, TimeShiftOptions } from "../core/SubtitleUtil.svelte";
import { KeybindingManager, type CommandBinding } from "./Keybinding";
import { Editing } from "./Editing";

import { _, unwrapFunctionStore } from 'svelte-i18n';
const $_ = unwrapFunctionStore(_);

export class DialogHandler<TInput = void, TOutput = string> {
    showModal?: (i: TInput) => Promise<TOutput>;
}

export const Dialogs = {
    importOptions: new DialogHandler<boolean, MergeOptions | null>(),
    timeTransform: new DialogHandler<void, TimeShiftOptions | null>(),
    combine: new DialogHandler<void, void>(),
    configuration: new DialogHandler<void, void>(),
    keybinding: new DialogHandler<void, void>(),
    keybindingInput: new DialogHandler<
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        [UICommand<any>, CommandBinding | null], CommandBinding | null>(),
    splitByLine: new DialogHandler<void, void>(),
    export: new DialogHandler<void, {content: string, ext: string} | null>(),
    encoding: new DialogHandler<
        {path: string, source: Uint8Array, result: AnalyseResult}, 
        {decoded: string, encoding: EncodingName} | null>(),
    bugs: new DialogHandler<void, void>(),
    referenceSources: new DialogHandler<void, void>()
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
KeybindingManager.register(DialogCommands);