import { untrack } from "svelte";

// todo: for some reason Svelte no longer exports the type Snapshot<T>
// but there's nothing we can do about it
export function hook<T>(track: () => T, action: (value: $state.Snapshot<T>) => void) {
    $effect(() => {
        const value = $state.snapshot(track());
        untrack(() => action(value));
    });
}
