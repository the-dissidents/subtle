import * as z from "zod/v4-mini";
import { Memorized } from "../config/MemorizedValue.svelte";
import { invoke } from "@tauri-apps/api/core";
import { Debug } from "../Debug";

const zProviderConfig = z.object({
    name: z.string().check(z.minLength(1)),
    endpoint: z.string().check(z.minLength(1)),
    model: z.string().check(z.minLength(1)),
    maxContext: z.int().check(z.positive()),
});

export type ProviderConfig = z.infer<typeof zProviderConfig>;

const providers = Memorized.$(
    'aiProviders', z.array(zProviderConfig), []
);

const activeProviderName = Memorized.$(
    'aiActiveProvider', z.string(), ''
);

export const ProviderStore = {
    get providers() { return providers; },
    get activeProviderName() { return activeProviderName; },

    loadProviders(): ProviderConfig[] {
        return providers.get();
    },

    saveProvider(config: ProviderConfig) {
        const parsed = z.parse(zProviderConfig, config);
        const list = [...providers.get()];
        const idx = list.findIndex(p => p.name === parsed.name);
        if (idx >= 0) {
            list[idx] = parsed;
        } else {
            list.push(parsed);
        }
        providers.set(list);
        if (!activeProviderName.get()) {
            activeProviderName.set(parsed.name);
        }
    },

    deleteProvider(name: string) {
        const list = providers.get().filter(p => p.name !== name);
        providers.set(list);
        if (activeProviderName.get() === name) {
            activeProviderName.set(list[0]?.name ?? '');
        }
    },

    getActiveProvider(): ProviderConfig | undefined {
        const name = activeProviderName.get();
        if (!name) return undefined;
        return providers.get().find(p => p.name === name);
    },

    setActiveProvider(name: string) {
        Debug.assert(
            providers.get().some(p => p.name === name),
            `provider "${name}" not found`
        );
        activeProviderName.set(name);
    },

    async storeApiKey(endpoint: string, key: string): Promise<void> {
        await invoke<void>('store_api_key', { endpoint, key });
    },

    async loadApiKey(endpoint: string): Promise<string | null> {
        return await invoke<string | null>('load_api_key', { endpoint });
    },
};
