<script lang="ts">
    import { MAPI } from "./API";
    import { assert } from "./Basic";
    import type { Frontend } from "./Frontend";

    interface Props {
        frontend: Frontend;
    }

    let { frontend }: Props = $props();
    let result = $state("");

    MAPI.version().then((x) => result = `ffmpeg version is ${x}`);
</script>

<button
    onclick={async () => {
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
        await media.moveToNextVideoFrame();
        await media.readCurrentVideoFrame();
        result = `done: t=${performance.now() - t0}\n`;
    }}>
    next video frame
</button>
<button
    onclick={async () => {
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
        assert(video.currentPosition !== undefined);
        assert(video.framerate !== undefined);
        let pos = video.currentPosition * video.framerate - 1;
        await video.setPosition(pos / video.framerate);
        await media.readCurrentVideoFrame();
        result = `done: t=${performance.now() - t0}\n`;
    }}>
    previous video frame
</button>
<br>
<span>{result}</span>