<script lang="ts">
    import { IPC, MAPI } from "./API";
    import type { Frontend } from "./Frontend";

	export let frontend: Frontend;
    let result = "";
</script>

<button
    on:click={async () => {
        await MAPI.testResponse();
    }}>
    test response
</button>
<button
    on:click={async () => {
        let video = frontend.playback.video;
        if (video == null) {
            result = "No video!";
            return;
        }
        let media = video._testGetMedia();
        if (media == null) {
            result = "No MMedia!";
            return;
        }
        let t0 = performance.now();
        await media.readNextVideoFrame();
        result = `readNextVideoFrame done: t=${performance.now() - t0}\n`;
    }}>
    read video frame
</button>
<br>
<span>{result}</span>