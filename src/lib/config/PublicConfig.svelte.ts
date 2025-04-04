console.info('PublicConfig loading');

import Ajv, { type JSONSchemaType, type ValidateFunction } from "ajv";
import { assert, never } from "../Basic";
import { path } from "@tauri-apps/api";
import * as fs from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";

const ajv = new Ajv({
    removeAdditional: true,
    useDefaults: true
});

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

type GroupSchema<T extends PublicConfigGroupDefinition> = JSONSchemaType<GroupType<T>>;

export class PublicConfigGroup<T extends PublicConfigGroupDefinition> {
    data: GroupType<T> = $state({} as any);
    readonly defaults: Readonly<GroupType<T>>;
    readonly validate: ValidateFunction<GroupType<T>>;

    constructor(
        public readonly name: () => string,
        public readonly description: (() => string) | null,
        public readonly priority: number,
        public readonly definition: T,
    ) {
        let defaults = {} as any;

        let schema: GroupSchema<T> = {
            type: "object",
            properties: {},
            required: []
        };
        for (const key in definition) {
            const def = definition[key];
            this.data[key] = def.default;
            defaults[key] = def.default;

            schema.properties[key] = {};
            const prop = schema.properties[key];
            switch (def.type) {
                case "string":
                case "boolean":
                    prop.type = def.type;
                    prop.default = def.default;
                    break;
                case "integer":
                case "number":
                    prop.type = def.type;
                    prop.default = def.default;
                    if (!def.bounds) break;
                    if (def.bounds[0] !== null)
                        prop.minimum = def.bounds[0];
                    if (def.bounds[1] !== null)
                        prop.maximum = def.bounds[1];
                    break;
                case "select":
                case "dropdown":
                    prop.enum = Object.keys(def.options);
                    prop.default = def.default;
                    break;
                default:
                    never(def);
            }
        }
        
        this.defaults = defaults;
        this.validate = ajv.compile<GroupType<T>>(schema);
    }
}

export class PublicConfig {
    groups: Record<string, PublicConfigGroup<PublicConfigGroupDefinition>> = {};

    get configPath() {
        assert(this.#initialized);
        return this.#configPath;
    }

    #configPath: string = '';
    #initialized = false;
    #onInitCallbacks: (() => void)[] = [];

    constructor(public readonly name: string) {}

    addGroup(name: string, group: PublicConfigGroup<PublicConfigGroupDefinition>) {
        assert(!this.#initialized);
        assert(this.groups[name] === undefined);
        console.log(`added group ${name} for ${this.name}`);
        this.groups[name] = group;
    }

    async init() {
        const configName = `${this.name}.json`;
        this.#configPath = await join(await path.appConfigDir(), configName);
        try {
            if (!await fs.exists(configName, {baseDir: fs.BaseDirectory.AppConfig})) {
                console.log('no config file found for', this.name);
                return;
            }
            let obj = JSON.parse(await fs.readTextFile(
                configName, {baseDir: fs.BaseDirectory.AppConfig}));
            console.log(obj);

            for (const key in this.groups) {
                const group = this.groups[key];
                const object: unknown = obj[key];
                if (object !== undefined) {
                    if (!group.validate(object)) {
                        console.warn(`invalid config for group ${key}:`, group.validate.errors);
                        continue;
                    }
                    group.data = object;
                }
            }
        } catch (e) {
            console.error('error reading config file for', this.name, e);
        } finally {
            this.#initialized = true;
            for (const callback of this.#onInitCallbacks)
                callback();
        }
    }

    async save() {
        const configName = `${this.name}.json`;
        const configDir = await path.appConfigDir();
        if (!await fs.exists(configDir))
            await fs.mkdir(configDir, {recursive: true});
    
        let data: Record<string, GroupType<any>> = {};
        for (const key in this.groups)
            data[key] = this.groups[key].data;

        await fs.writeTextFile(configName, 
            JSON.stringify(data, null, 2), {baseDir: fs.BaseDirectory.AppConfig});
    }

    onInitialized(callback: () => void) {
        if (!this.#initialized) this.#onInitCallbacks.push(callback);
        else callback();
    }
}