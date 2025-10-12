console.info('MemorizedValue loading');

import { path } from "@tauri-apps/api";
import { Basic } from "../Basic";
import { Debug } from "../Debug";
import { BaseDirectory, exists, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import * as z from "zod/v4-mini";
import { guardAsync } from "../frontend/Frontend";

import { _ } from 'svelte-i18n';
import { get } from "svelte/store";

const configPath = 'memorized.json';
const memorizedData: Record<string, Memorized<unknown, unknown>> = {};
let initialized = false;
const onInitCallbacks: (() => void)[] = [];

export abstract class Memorized<S, Orig = S> {
    protected subscriptions = new Set<(value: Orig) => void>();

    static $<T extends z.core.$ZodType>(key: string, ztype: T, initial: z.infer<T>) {
        if (key in memorizedData) {
            const otherType = memorizedData[key].type;
            Debug.assert(
                JSON.stringify(ztype._zod.def) === otherType, 
                'type mismatch');
            return memorizedData[key] as SimpleMemorized<T>;
        }
        return new SimpleMemorized(key, ztype, initial);
    }

    static $overridable<T extends z.core.$ZodType>(key: string, ztype: T, initial: z.infer<T>) {
        if (key in memorizedData) {
            const otherType = memorizedData[key].type;
            Debug.assert(
                JSON.stringify(ztype._zod.def) === otherType, 
                'type mismatch');
            Debug.assert(memorizedData[key] instanceof OverridableMemorized);
            return memorizedData[key] as OverridableMemorized<T>;
        }
        return new OverridableMemorized(key, ztype, initial);
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
            for (const [key, value] of Object.entries(obj)) {
                if (key in memorizedData) {
                    memorizedData[key].deserialize(value);
                } else {
                    Debug.warn('unrecognized pair in memorized data file', key, value);
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
            const data: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(memorizedData)) {
                data[key] = value.serialize();
            }
            await writeTextFile(configPath, 
                JSON.stringify(data), {baseDir: BaseDirectory.AppConfig});
            await Debug.debug('saved memorized values');
        }, get(_)('msg.error-saving-private-config'));
    }

    protected constructor(
        protected key: string, 
        protected value: Orig,
    ) {
        (memorizedData[key] as Memorized<S, Orig>) = this;
    }

    protected abstract get type(): string;
    protected abstract serialize(): S;
    protected abstract deserialize(value: unknown): void;

    subscribe(subscription: (value: Orig) => void): (() => void) {
        this.subscriptions.add(subscription);
        subscription(this.get());
        return () => this.subscriptions.delete(subscription);
    }

    get(): Orig {
        return this.value;
    }

    set(value: Orig) {
        this.value = value;
        this.subscriptions.forEach((x) => x(value));
    }

    markChanged() {
        this.subscriptions.forEach((x) => x(this.value));
    }
}

export class SimpleMemorized<T extends z.core.$ZodType> extends Memorized<z.infer<T>> {
    #typeid: string;

    constructor(
        key: string, 
        protected ztype: T,
        value: z.infer<T>
    ) {
        super(key, value);
        this.#typeid = JSON.stringify(ztype._zod.def);
    }

    protected override get type() {
        return this.#typeid;
    }

    protected override serialize(): z.infer<T> {
        return this.value;
    }

    protected override deserialize(value: unknown) {
        const result = z.safeParse(this.ztype, value);
        if (!result.success)
            Debug.warn('type mismatch in memorized data file', 
                this.key, value, z.prettifyError(result.error));
        else
            this.set(result.data);
    }
}

export class OverridableMemorized<T extends z.core.$ZodType> extends SimpleMemorized<T> {
    #override: z.infer<T> | undefined;

    override get() {
        return this.override ?? this.value;
    }

    override set(value: z.infer<T>) {
        this.value = value;
        if (this.override === undefined)
            this.subscriptions.forEach((x) => x(value));
    }

    get setting() {
        return this.value;
    }

    set setting(value: z.infer<T>) {
        this.set(value);
    }

    get override() {
        return this.#override;
    }

    set override(value: z.infer<T> | undefined) {
        this.#override = value;
        this.subscriptions.forEach((x) => x(this.override ?? this.value));
    }
}