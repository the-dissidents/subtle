console.info('Dialogs loading');

import type { AnalyseResult, EncodingName } from "chardet"
import type { MergeOptions, TimeShiftOptions } from "../core/SubtitleUtil.svelte";
import { mount, unmount } from "svelte";
import OverlayMenu from "../ui/OverlayMenu.svelte";
import type { UICommand } from "./CommandBase";
import type { CommandBinding } from "./Keybinding";

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
    keybindingInput: new DialogHandler<[UICommand, CommandBinding | null], CommandBinding | null>(),
    splitByLine: new DialogHandler<void, void>(),
    export: new DialogHandler<void, {content: string, ext: string} | null>(),
    encoding: new DialogHandler<
        {source: Uint8Array, result: AnalyseResult}, 
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