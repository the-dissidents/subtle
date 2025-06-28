import { path } from "@tauri-apps/api";
import { Basic } from "../Basic";
import { Debug } from "../Debug";
import { BaseDirectory, exists, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { z } from "zod/v4-mini";
import { guardAsync } from "../frontend/Interface";

import { _ } from 'svelte-i18n';
import { get } from "svelte/store";

const zValue = z.union([z.string(), z.number(), z.boolean()]);
const zData = z.record(z.string(), zValue);
export type MemorizableValue = z.infer<typeof zValue>;

const configPath = 'memorized.json';
let memorizedData: Record<string, Memorized<any>> = {};
let initialized = false;
let onInitCallbacks: (() => void)[] = [];

export class Memorized<T extends MemorizableValue> {
    #subscriptions = new Set<(value: T) => void>();

    static $<T extends MemorizableValue>(key: string, initial: T) {
        if (key in memorizedData) {
            Debug.assert(typeof memorizedData[key].get() == typeof initial, 'type mismatch');
            return memorizedData[key] as Memorized<T>;
        }
        return new Memorized(key, initial);
    }

    static isInitialized() {
        return initialized;
    }

    static async init() {
        Debug.assert(!initialized);
        await Debug.debug('reading memorized data:', await path.appConfigDir(), configPath);
        try {
            if (!await exists(configPath, {baseDir: BaseDirectory.AppConfig})) {
                await Debug.info('no memorized data found');
                return;
            }
            const obj = JSON.parse(await readTextFile(
                configPath, {baseDir: BaseDirectory.AppConfig}));
            for (const [key, value] of Object.entries(z.parse(zData, obj))) {
                if (key in memorizedData) {
                    Debug.assert(typeof memorizedData[key].get() == typeof value);
                    memorizedData[key].set(value);
                } else {
                    Memorized.$(key, value);
                }
            }
        } catch (e) {
            await Debug.warn('error reading memorized data:', e);
        } finally {
            initialized = true;
            onInitCallbacks.forEach((x) => x());
        }
    }

    static onInitialize(callback: () => void) {
        if (initialized) callback();
        else {
            onInitCallbacks.push(callback);
        }
    }

    static async save() {
        Debug.assert(initialized);
        await Basic.ensureConfigDirectoryExists();
        await guardAsync(async () => {
            let data: Record<string, MemorizableValue> = {};
            for (const [key, value] of Object.entries(memorizedData)) {
                data[key] = value.get();
            }
            await writeTextFile(configPath, 
                JSON.stringify(data), {baseDir: BaseDirectory.AppConfig});
        }, get(_)('msg.error-saving-private-config'));
    }

    private constructor(key: string, private value: T) {
        memorizedData[key] = this;
    }

    subscribe(subscription: (value: T) => void): (() => void) {
        this.#subscriptions.add(subscription);
        subscription(this.value);
        return () => this.#subscriptions.delete(subscription);
    }

    get(): T {
        return this.value;
    }

    set(value: T) {
        this.value = value;
        this.#subscriptions.forEach((x) => x(value));
    }
}