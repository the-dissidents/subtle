import { path } from "@tauri-apps/api";
import * as fs from "@tauri-apps/plugin-fs"
import { assert } from "./Basic";

const configPath = 'config.json';
let configData = {
    maxRecent: 10,
    paths: [] as {name: string, video?: string}[],

    mouseScrollSensitivity: 1,
    trackpadScrollSensitivity: 10,
    mouseZoomSensitivity: 0.05,
    trackpadZoomSensitivity: 1,

    windowW: 1000,
    windowH: 800,
    windowX: 200,
    windowY: 200,
    
    editorH: 125,
    timelineH: 150,
    leftPaneW: 300,
    videoH: 200
};

let initialized = false;
let onInitCallbacks: (() => void)[] = [];

type ConfigType = typeof configData;
type ConfigKey = keyof ConfigType;

async function saveConfig() {
    const configDir = await path.appConfigDir();
    if (!await fs.exists(configDir))
        await fs.mkdir(configDir, {recursive: true});

    try {
        await fs.writeTextFile(configPath, 
            JSON.stringify(configData), {baseDir: fs.BaseDirectory.AppConfig});
    } catch (e) {
        // fail silently
        console.error('error saving config:', e);
    }
}

export const Config = {
    async init() {
        console.log(await path.appConfigDir(), configPath);
        try {
            if (!await fs.exists(configPath, {baseDir: fs.BaseDirectory.AppConfig})) {
                console.log('no config file found');
                return;
            }
            let obj = JSON.parse(await fs.readTextFile(
                configPath, {baseDir: fs.BaseDirectory.AppConfig}));
            configData = Object.assign(configData, obj);
            console.log(configData);
        } catch (e) {
            console.error('error reading config file:', e);
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
        assert(initialized);
        configData[key] = value;
        await saveConfig();
    },
    get<prop extends ConfigKey>(key: prop): ConfigType[prop] {
        assert(initialized);
        return configData[key];
    },
    pushRecent(file: string) {
        assert(initialized);
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
        assert(initialized);
        return configData.paths.find((x) => x.name == file)?.video;
    },
    rememberVideo(file: string, video: string) {
        assert(initialized);
        assert(configData.paths.length > 0 && configData.paths[0].name == file);
        configData.paths[0].video = video;
        saveConfig();
    }
}