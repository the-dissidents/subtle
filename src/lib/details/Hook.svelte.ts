import { untrack } from "svelte";

export function hook<T>(track: () => T, action: (value: $state.Snapshot<T>) => void) {
    $effect(() => {
        const value = $state.snapshot(track());
        untrack(() => action(value));
    });
}