<script lang="ts">
    import chardet from 'chardet';
    import * as dialog from "@tauri-apps/plugin-dialog";
    import * as fs from "@tauri-apps/plugin-fs";
    
    import { MAPI, MMedia } from "../API";
    import { assert } from "../Basic";
    import { Playback } from "../frontend/Playback";

    let result = $state("");
    MAPI.version().then((x) => result = `ffmpeg version is ${x}`);

    let media: MMedia | undefined;
</script>

<button
    onclick={async () => {
        let path = await dialog.open();
        if (!path) return;
        media = await MMedia.open(path);
        console.log('media opened');
        await media.openVideo(-1);
        console.log('video opened');
        await media.openAudio(-1);
        console.log('audio opened');
        result = media.streams.join(';');
    }}>
    open media
</button>


<button
    onclick={async () => {
        if (!media) return;
        let result = await media.readNextFrame();
        if (!result) console.log("EOF!");
        else console.log(`${result.type} @${result.position}, time=${result.time}, length ${result.content.length}`)
    }}>
    read frame
</button>
<button
    onclick={async () => {
        let path = await dialog.open();
        if (!path) return;
        let file = await fs.readFile(path);
        let detected = chardet.analyse(file);
        result = detected.map((x) => `${x.name} -- ${x.confidence}`).join('\n');
    }}>
    detect encoding
</button>
<br>
<span>{result}</span>