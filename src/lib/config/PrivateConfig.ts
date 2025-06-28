console.info('PrivateConfig loading');

import { path } from "@tauri-apps/api";
import * as fs from "@tauri-apps/plugin-fs"
import { guardAsync } from "../frontend/Interface";

import { unwrapFunctionStore, _ } from 'svelte-i18n';
import { Debug } from "../Debug";
import { Basic } from "../Basic";
const $_ = unwrapFunctionStore(_);

export type FileSaveState = {
    name: string, 
    video?: string,
    audioStream?: number,
    scroll?: number,
    focus?: number
}

const configPath = 'config.json';
let configData = {
    maxRecent: 10,
    paths: [] as FileSaveState[]
};

let initialized = false;
let onInitCallbacks: (() => void)[] = [];

type ConfigType = typeof configData;
type ConfigKey = keyof ConfigType;

async function saveConfig() {
    await Basic.ensureConfigDirectoryExists();
    await guardAsync(async () => {
        await fs.writeTextFile(configPath, 
            JSON.stringify(configData, null, 2), {baseDir: fs.BaseDirectory.AppConfig}); 
    }, $_('msg.error-saving-private-config'));
}

export const PrivateConfig = {
    async init() {
        await Debug.debug('reading private config:', await path.appConfigDir(), configPath);
        try {
            if (!await fs.exists(configPath, {baseDir: fs.BaseDirectory.AppConfig})) {
                await Debug.info('no private config found');
                return;
            }
            let obj = JSON.parse(await fs.readTextFile(
                configPath, {baseDir: fs.BaseDirectory.AppConfig}));
            configData = Object.assign(configData, obj);
            Debug.trace(configData);
        } catch (e) {
            await Debug.warn('error reading private config:', e);
        } finally {
            initialized = true;
            for (const callback of onInitCallbacks)
                callback();
        }
    },
    onInitialized(callback: () => void) {
        if (!initialized) onInitCallbacks.push(callback);
        else callback();
    },

    async set<prop extends ConfigKey>(key: prop, value: ConfigType[prop]) {
        Debug.assert(initialized);
        configData[key] = value;
        await saveConfig();
    },
    get<prop extends ConfigKey>(key: prop): ConfigType[prop] {
        Debug.assert(initialized);
        return configData[key];
    },
    async pushRecent(file: string) {
        Debug.assert(initialized);
        const i = configData.paths.findIndex((x) => x.name == file);
        if (i >= 0)
            configData.paths.unshift(...configData.paths.splice(i, 1));
        else
            configData.paths.unshift({name: file});
        while (configData.paths.length > configData.maxRecent)
            configData.paths.pop();
        await saveConfig();
    },
    getFileData(file: string) {
        Debug.assert(initialized);
        return configData.paths.find((x) => x.name == file);
    },
    async setFileData(file: string, v: Omit<FileSaveState, 'name'> | undefined) {
        Debug.assert(initialized);
        Debug.assert(configData.paths.length > 0 && configData.paths[0].name == file);
        Object.assign(configData.paths[0], v);
        await saveConfig();
    },
}