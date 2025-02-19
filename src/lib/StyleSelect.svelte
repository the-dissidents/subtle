<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import type { SubtitleStyle, Subtitles } from "./Subtitles";

    interface Props {
        subtitles: Subtitles;
        currentStyle: SubtitleStyle;
    }

    let { subtitles, currentStyle = $bindable() }: Props = $props();
    let refresh = $state(0);

	const dispatch = createEventDispatcher();
	const submit = () => dispatch('submit');
</script>

<select class='styleselect' tabindex='-1'
    oninput={(ev) => {
        let index = ev.currentTarget.selectedIndex;
        if (index <= 0) currentStyle = subtitles.defaultStyle;
        else currentStyle = subtitles.styles[index - 1];
        submit();
    }}
    onclick={() => refresh++}
>
    {#key refresh}
    <option selected={currentStyle == subtitles.defaultStyle}>
        {subtitles.defaultStyle.name}
    </option>
    {#each subtitles.styles as style}
    <option selected={currentStyle == style}>{style.name}</option>
    {/each}
    {/key}
</select>

<style>
</style>