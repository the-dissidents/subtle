import type { ReferencesHandler } from "../toolbox/ReferencesToolbox.svelte";
import type { SearchHandler } from "../toolbox/SearchToolbox.svelte";

export const Toolboxes = {
    search: undefined as SearchHandler | undefined,
    references: undefined as ReferencesHandler | undefined
};