import {  path } from "@tauri-apps/api";
import { BaseDirectory } from "@tauri-apps/plugin-fs";
import { assert } from "./Basic";
import * as fs from "@tauri-apps/plugin-fs"

const configPath = 'config.json';
let configData = {
    windowsW: 1000,
    windowsH: 800,
    editorH: 200,
    timelineH: 150,
    maxRecent: 10,
    paths: [] as {name: string, video?: string}[],
};

type ConfigType = typeof configData;
type ConfigKey = keyof ConfigType;

async function saveConfig() {
    const configDir = await path.appConfigDir();
    if (!await fs.exists(configDir))
        await fs.mkdir(configDir, {recursive: true});

    try {
        await fs.writeTextFile(configPath, 
            JSON.stringify(configData), {baseDir: BaseDirectory.AppConfig});
    } catch (e) {
        // fail silently
        console.error('error saving config:', e);
    }
}

export const Config = {
    async init() {
        console.log(await path.appConfigDir(), configPath);
        if (!await fs.exists(configPath, {baseDir: BaseDirectory.AppConfig}))
            return;
        try {
            configData = JSON.parse(await fs.readTextFile(
                configPath, {baseDir: BaseDirectory.AppConfig}));
        } catch (e) {
            console.error('error reading config file:', e);
        }
    },
    set<prop extends ConfigKey>(key: prop, value: ConfigType[prop]) {
        configData[key] = value;
        saveConfig();
    },
    get<prop extends ConfigKey>(key: prop): ConfigType[prop] {
        return configData[key];
    },
    pushRecent(file: string) {
        const i = configData.paths.findIndex((x) => x.name == file);
        if (i >= 0)
            configData.paths.unshift(...configData.paths.splice(i, 1));
        else
            configData.paths.unshift({name: file});
        while (configData.paths.length > configData.maxRecent)
            configData.paths.pop();
        saveConfig();
    },
    getVideo(file: string): string | undefined {
        return configData.paths.find((x) => x.name == file)?.video;
    },
    rememberVideo(file: string, video: string) {
        assert(configData.paths.length > 0 && configData.paths[0].name == file);
        configData.paths[0].video = video;
        saveConfig();
    }
}