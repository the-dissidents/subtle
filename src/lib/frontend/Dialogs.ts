import type { AnalyseResult, EncodingName } from "chardet"
import type { MergeOptions, TimeShiftOptions } from "../core/Subtitles.svelte"

export class DialogHandler<TInput = void, TOutput = string> {
    showModal?: (i: TInput) => Promise<TOutput>;
}

export const Dialogs = {
    modalOpenCounter: 0,

    importOptions: new DialogHandler<void, MergeOptions | null>(),
    timeTransform: new DialogHandler<void, TimeShiftOptions | null>(),
    combine: new DialogHandler<void, void>(),
    configuration: new DialogHandler<void, void>(),
    export: new DialogHandler<void, {content: string, ext: string} | null>(),
    encoding: new DialogHandler<
        {source: Uint8Array, result: AnalyseResult}, 
        {decoded: string, encoding: EncodingName} | null>(),
}