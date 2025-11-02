console.info('PublicConfig loading');

import { path } from "@tauri-apps/api";
import { join } from "@tauri-apps/api/path";
import * as fs from "@tauri-apps/plugin-fs";
import { Debug } from "../Debug";
import { Basic } from "../Basic";
import { tick } from "svelte";
import { hook } from "../details/Hook.svelte";
import * as z from "zod/v4-mini";

export type PublicConfigItem = {
    localizedName: () => string,
    description?: () => string
} & ({
    type: 'number',
    bounds?: [number | null, number | null],
    default: number
} | {
    type: 'integer',
    bounds?: [number | null, number | null],
    default: number
} | {
    type: 'string',
    default: string
} | {
    type: 'boolean',
    default: boolean
} | {
    type: 'select',
    options: {[key: string]: {
        localizedName: () => string,
        description?: () => string
    }},
    default: string
} | {
    type: 'dropdown',
    options: {[key: string]: {
        localizedName: () => string
    }},
    default: string
});
// TODO: color

export type PublicConfigGroupDefinition = Record<string, PublicConfigItem>;

type GroupType<T extends PublicConfigGroupDefinition> = {
    [key in keyof T]: T[key]['default']
};

export class PublicConfigGroup<T extends PublicConfigGroupDefinition> {
    data: GroupType<T> = $state({} as GroupType<T>);
    readonly defaults: Readonly<GroupType<T>>;
    readonly ztype: z.core.$ZodType<GroupType<T>>;

    constructor(
        public readonly name: () => string,
        public readonly description: (() => string) | null,
        public readonly priority: number,
        public readonly definition: T,
    ) {
        const schemaContent: {[key: string]: z.core.$ZodType} = {};
        for (const key in definition) {
            const def = definition[key];
            this.data[key] = def.default;
            switch (def.type) {
                case "boolean":
                    schemaContent[key] = z._default(z.boolean(), def.default);
                    break;
                case "string":
                    schemaContent[key] = z._default(z.string(), def.default);
                    break;
                case "number":
                case "integer": {
                    let n = def.type == 'integer' ? z.int() : z.number();
                    if (def.bounds && def.bounds[0] !== null)
                        n = n.check(z.gte(def.bounds[0]));
                    if (def.bounds && def.bounds[1] !== null)
                        n = n.check(z.lte(def.bounds[1]));
                    schemaContent[key] = z._default(n, def.default);
                    break;
                }
                case "select":
                case "dropdown":
                    schemaContent[key] = z._default(z.enum(Object.keys(def.options)), def.default);
                    break;
                default:
                    Debug.never(def);
            }
        }
        
        this.ztype = z.pipe(z.object(schemaContent), z.transform((x) => x as GroupType<T>));
        this.defaults = z.parse(this.ztype, {});
    }
}

export class PublicConfig {
    groups: Record<string, PublicConfigGroup<PublicConfigGroupDefinition>> = {};

    get configPath() {
        Debug.assert(this.#initialized);
        return this.#configPath;
    }

    #configPath: string = '';
    #initialized = false;
    #onInitCallbacks: (() => void)[] = [];

    get isInitialized() { return this.#initialized; }

    constructor(public readonly name: string) {}

    addGroup(name: string, group: PublicConfigGroup<PublicConfigGroupDefinition>) {
        Debug.assert(!this.#initialized);
        Debug.assert(this.groups[name] === undefined, `config group ${name} already exists`);
        this.groups[name] = group;
    }

    async init() {
        const configName = `${this.name}.json`;
        this.#configPath = await join(await path.appConfigDir(), configName);
        try {
            if (!await fs.exists(configName, {baseDir: fs.BaseDirectory.AppConfig})) {
                await Debug.debug('no config file found for', this.name);
                return;
            }
            const obj = JSON.parse(await fs.readTextFile(
                configName, {baseDir: fs.BaseDirectory.AppConfig}));

            for (const key in this.groups) {
                const group = this.groups[key];
                const object: unknown = obj[key];
                if (object !== undefined) {
                    const validated = z.safeParse(group.ztype, object);
                    if (!validated.success) {
                        await Debug.warn(`invalid config for group ${key}:`, validated.error);
                        continue;
                    }
                    group.data = validated.data;
                }
            }
        } catch (e) {
            await Debug.warn('error reading config file for', this.name, e);
        } finally {
            this.#initialized = true;
            for (const callback of this.#onInitCallbacks)
                tick().then(() => callback());
        }
    }

    async save() {
        await Basic.ensureConfigDirectoryExists();
    
        const data: Record<string, GroupType<PublicConfigGroupDefinition>> = {};
        for (const key in this.groups)
            data[key] = this.groups[key].data;

        const configName = `${this.name}.json`;
        await fs.writeTextFile(configName, 
            JSON.stringify(data, null, 2), {baseDir: fs.BaseDirectory.AppConfig});
    }

    onInitialized(callback: () => void) {
        if (!this.#initialized) {
            this.#onInitCallbacks.push(callback);
        } else callback();
    }

    hook<T>(track: () => T, action: (value: $state.Snapshot<T>) => void) {
        this.onInitialized(() => action($state.snapshot(track())));
        
        hook(track, (value) => {
            if (!this.#initialized) return;
            action(value);
        });
    }
}