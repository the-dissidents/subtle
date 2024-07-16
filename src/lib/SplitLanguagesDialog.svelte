<script lang="ts">
    import DialogBase from './DialogBase.svelte';
    import StyleSelect from './StyleSelect.svelte';
    import { SubtitleStyle, type SubtitleChannel } from './Subtitles';
    import { ChangeCause, ChangeType, Frontend } from './Frontend';
    // @ts-ignore
    import * as eld from 'eld';

    export let frontend: Frontend;
	export let show = false;
    let langs: [string, [number, style: SubtitleStyle, def: boolean]][] = [];
    let prompt = '';
    let filterString = 'zh ja en fr de it es';
    let mergeAdjacent = true;
    let ignoreSingleline = true;

    let refresh = 0;
    let analyze = 0;

    function getLanguage(text: string, filter: Set<string>) {
        let result = 
            Object.entries(eld.eld.detect(text).getScores()) as [string, number][];
        let maxl = '?', maxp = 0;
        for (const [l, p] of result) {
            if (filter.size > 0 && !filter.has(l)) continue;
            if (p > maxp) {
                maxl = l;
                maxp = p;
            }
        }
        return maxl;
    }

    async function initDetection() {
        // if (!inited) {
            await eld.eld.loadNgrams('ngramsL60.js');
            // inited = true;
        // }
    }

    async function detectLanguages() {
        let filt = new Set(filterString.split(' '));
        let langs = new Map<string, [number, style: SubtitleStyle, def: boolean]>();
        langs.clear();
        for (let entry of frontend.subs.entries) {
            for (let channel of entry.texts) {
                let split = channel.text.split('\n').filter((x) => x.length > 0);
                if (split.length <= 1 && ignoreSingleline) continue;
                let last = '';
                for (const l of split) {
                    let lng = getLanguage(l, filt);
                    if (mergeAdjacent) {
                        if (lng == last) continue;
                        last = lng;
                    }
                    if (langs.has(lng))
                        langs.get(lng)![0]++;
                    else
                        langs.set(lng, [1, frontend.subs.defaultStyle, false])
                }
            }
        }
        return langs;
    }

    async function run() {
        let filt = new Set(filterString.split(' '));
        let langsMap = new Map(langs);
        for (let entry of frontend.subs.entries) {
            let newChannels: SubtitleChannel[] = [];
            for (let channel of entry.texts) {
                let split = channel.text.split('\n').filter((x) => x.length > 0);
                if (split.length <= 1 && ignoreSingleline) {
                    newChannels.push(channel);
                    continue;
                }
                let last = '';
                for (const l of split) {
                    let lng = getLanguage(l, filt);
                    if (mergeAdjacent) {
                        if (lng == last) {
                            newChannels.at(-1)!.text += '\n' + l;
                            continue;
                        };
                        last = lng;
                    }
                    let style = channel.style;
                    if (langsMap.get(lng)?.[2]) style = langsMap.get(lng)![1];
                    newChannels.push({style: style, text: l});
                }
            }
            entry.texts = newChannels;
        }
        show = false;
        
        frontend.markChanged(ChangeType.Both, ChangeCause.Action);
    }

    async function init() {
        if (!show) return;
        prompt = 'analyzing...';
        await initDetection();
        langs = [...await detectLanguages()].sort((x, y) => y[1][0] - x[1][0]);
        prompt = langs.length + ' languages detected';
        refresh++;
    }

    let setAllUse = false;
    let setAllStyle = frontend.subs.defaultStyle;
    function setAll() {
        for (const lng of langs) {
            lng[1][2] = setAllUse;
            lng[1][1] = setAllStyle;
        }
        refresh++;
    }

    $: show, analyze, init();
</script>

<DialogBase bind:frontend bind:show>
    <table class="config">
        <tr>
            <td></td>
            <td colspan="2">{prompt}</td>
        </tr>
        <tr>
            <td>restrict to</td>
            <td colspan="2">
                <input type="text" bind:value={filterString}>
                <button on:click={() => analyze++}>analyze again</button><hr>
                <input type="checkbox" bind:checked={mergeAdjacent}>
                merge adjacent lines having a same style<br>
                <input type="checkbox" bind:checked={ignoreSingleline}>
                ignore single-line entries
                <hr/>
            </td>
        </tr>
        {#key refresh}
        {#each langs as lang, index}
        <tr>
            <td>{lang[0]}</td>
            <td>{lang[1][0]} lines</td>
            <td>→
                <input type="radio" name="use{index}" value={true}
                    bind:group={lang[1][2]}>
                <StyleSelect subtitles={frontend.subs}
                    bind:currentStyle={lang[1][1]}/>
                <input type="radio" name="use{index}" value={false}
                    bind:group={lang[1][2]}>
                keep original
            </td>
        </tr>
        {/each}
        {/key}
        <tr>
            <td></td>
            <td><button on:click={() => setAll()}>set all</button></td>
            <td>→
                <input type="radio" name="use" value={true} bind:group={setAllUse}>
                <StyleSelect subtitles={frontend.subs}
                    bind:currentStyle={setAllStyle}></StyleSelect>
                <input type="radio" name="use" value={false} bind:group={setAllUse}>
                keep original
            </td>
        </tr>
        <tr>
            <td></td>
            <td colspan="2">
                <button style="width: 100%;" on:click={() => run()}>split lines</button>
            </td>
        </tr>
    </table>
</DialogBase>