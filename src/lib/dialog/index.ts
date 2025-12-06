export const Dialog = {
    get bugs() {
        return (async () => (await import('./BugDialog.svelte')).default)();
    },
    get combine() {
        return (async () => (await import('./CombineDialog.svelte')).default)();
    },
    get encoding() {
        return (async () => (await import('./EncodingDialog.svelte')).default)();
    },
    get configuration() {
        return (async () => (await import('./ConfigDialog.svelte')).default)();
    },
    get splitByLine() {
        return (async () => (await import('./SplitByLineDialog.svelte')).default)();
    },
    get referenceSources() {
        return (async () => (await import('./ReferenceSourcesDialog.svelte')).default)();
    },
    get keybinding() {
        return (async () => (await import('./KeybindingDialog.svelte')).default)();
    },
    get importOptions() {
        return (async () => (await import('./ImportOptionsDialog.svelte')).default)();
    },
    get exportASS() {
        return (async () => (await import('./ExportASSDialog.svelte')).default)();
    },
    get exportText() {
        return (async () => (await import('./ExportTextDialog.svelte')).default)();
    },
    get keybindingInput() {
        return (async () => (await import('./KeybindingInputDialog.svelte')).default)();
    },
    get transformTimes() {
        return (async () => (await import('./TimeTransformDialog.svelte')).default)();
    },
}