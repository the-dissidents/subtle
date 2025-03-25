import { get, writable } from "svelte/store";

import * as dialog from "@tauri-apps/plugin-dialog";
import * as fs from "@tauri-apps/plugin-fs";
import { Menu } from "@tauri-apps/api/menu";
import chardet from 'chardet';
import * as iconv from 'iconv-lite';

import { ASS } from "../core/ASS";
import type { Subtitles } from "../core/Subtitles.svelte";

import { Dialogs } from "./Dialogs";
import { ChangeCause, ChangeType, Source } from "./Source";
import { Editing } from "./Editing";
import { parseSubtitleSource } from "./Frontend";
import { PrivateConfig } from "../config/PrivateConfig";
import { Playback } from "./Playback";
import { DebugConfig } from "../config/Groups";

export enum UIFocus {
    Other,
    Table,
    EditingField,
    Timeline
}

const IMPORT_FILTERS = [
    { name: 'All supported formats', extensions: ['json', 'srt', 'vtt', 'ssa', 'ass'] },
    { name: 'SRT subtitles', extensions: ['srt'] },
    { name: 'VTT subtitles', extensions: ['vtt'] },
    { name: 'SSA subtitles', extensions: ['ssa', 'ass'] },
    { name: 'subtle archive', extensions: ['json'] }];

export async function guardAsync(x: () => Promise<void>, msg: string): Promise<void>;
export async function guardAsync<T>(x: () => Promise<T>, msg: string, fallback: T): Promise<T>;

export async function guardAsync<T>(x: () => Promise<T>, msg: string, fallback?: T) {
    if (DebugConfig.data.disableTry) {
        return await x();
    } else {
        try {
            return await x();
        } catch (x) {
            Interface.status.set(`${msg}: ${x}`);
            return fallback;
        };
    }
}

type EnforceNotPromise<T extends () => any> = ReturnType<T> extends Promise<any> ? never : T;

export function guard<T extends () => void>(x: EnforceNotPromise<T>, msg: string): void;
export function guard<T extends () => any>(
    x: EnforceNotPromise<T>, msg: string, fallback: ReturnType<T>): ReturnType<T>;

export function guard<T>(x: () => T, msg: string, fallback?: T) {
    if (DebugConfig.data.disableTry) {
        return x();
    } else {
        try {
            return x();
        } catch (x) {
            Interface.status.set(`${msg}: ${x}`);
            return fallback;
        };
    }
}

export const Interface = {
    uiFocus: writable(UIFocus.Other),
    status: writable('ok'),

    getUIFocus() {
        return get(this.uiFocus);
    },

    async readTextFile(path: string) {
        try {
            const stats = await fs.stat(path);
            if (!stats.isFile) {
                Interface.status.set(`not a file: ${path}`);
                return;
            }
            if (stats.size > 1024*1024*5 && !await dialog.ask("The file you're opening is very large and likely not a supported subtitle file. Do you really want to proceed? This may crash the application.", {kind: 'warning'})) return null;
        } catch {
            Interface.status.set(`does not exist: ${path}`);
            return;
        }
        return guardAsync(async () => {
            const file = await fs.readFile(path);
            const result = chardet.analyse(file);
            if (result[0].confidence == 100 
            && (result[0].name == 'UTF-8' || result[0].name == 'ASCII'))
            {
                return iconv.decode(file, 'UTF-8');
            } else {
                const out = await Dialogs.encoding.showModal!({source: file, result});
                if (!out) return null;
                return out.decoded;
            }
        }, `unable to read file ${path}`, null);
    },

    async openFile(path: string) {
        const text = await this.readTextFile(path);
        if (!text) return;
        let [newSubs, isJSON] = parseSubtitleSource(text);
        if (!newSubs) {
            this.status.set(`failed to parse as subtitles: ${path}`);
            return;
        }
        await Source.openDocument(newSubs, path, !isJSON);
        const video = PrivateConfig.getVideo(path);
        if (video) await this.openVideo(video);
    },

    async openVideo(videoFile: string) {
        guardAsync(async () => await Playback.load(videoFile), 
            `error opening video '${videoFile}'`);
        
        let source = get(Source.currentFile);
        if (source != '')
            PrivateConfig.rememberVideo(source, videoFile);
    },

    async warnIfNotSaved() {
        return !get(Source.fileChanged) || await dialog.confirm('Proceed without saving?');
    },

    async askImportFile() {
        const selected = await dialog.open({multiple: false, filters: IMPORT_FILTERS});
        if (typeof selected != 'string') return;
        const text = await this.readTextFile(selected);
        if (!text) return;
        let [newSubs, _] = parseSubtitleSource(text);
        if (!newSubs) {
            this.status.set(`failed to parse as subtitles: ${selected}`);
            return;
        }
        const options = await Dialogs.importOptions.showModal!();
        if (!options) return;

        let entries = Source.subs.merge(newSubs, options);
        if (entries.length > 0) {
            Editing.setSelection(entries);
        }
        Source.markChanged(ChangeType.General, ChangeCause.Action);
        Interface.status.set('imported');
    },

    async askExportFile() {
        let ask = async (ext: string, func: (s: Subtitles) => string) => {
            const selected = await dialog.save({
                filters: [{name: 'subtitle file', extensions: [ext]}]});
            if (typeof selected != 'string') return;
            await Source.exportTo(selected, func(Source.subs));
        }
        let menu = await Menu.new({items: [
            {
                text: 'ASS',
                action: () => ask('ass', (x) => ASS.export(x))
            },
            {
                text: 'SRT/plaintext/...',
                action: async () => {
                    const result = await Dialogs.export.showModal!();
                    if (!result) return;
                    ask(result.ext, () => result.content);
                }
            }
        ]});
        menu.popup();
    },
  
    async askOpenFile() {
        const path = await dialog.open({multiple: false, filters: IMPORT_FILTERS});
        if (typeof path != 'string') return;
        await this.openFile(path);
    },

    async askOpenVideo() {
        const selected = await dialog.open({multiple: false, 
            filters: [{name: 'video file', extensions: ['avi', 'mp4', 'webm', 'mkv']}]});
        if (typeof selected != 'string') return;
        await this.openVideo(selected);
    },
  
    async askSaveFile(saveAs = false) {
        let file = get(Source.currentFile);
        if (file == '' || saveAs) {
            const selected = await dialog.save({
                filters: [{name: 'subtle archive', extensions: ['json']}]});
            if (typeof selected != 'string') return;
            file = selected;
        }
        const text = JSON.stringify(Source.subs.toSerializable());
        if (await Source.saveTo(file, text) && Playback.video?.source)
            PrivateConfig.rememberVideo(file, Playback.video.source);
    }
}