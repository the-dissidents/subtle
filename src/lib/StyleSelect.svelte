<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import type { SubtitleStyle, Subtitles } from "./Subtitles";

    export let subtitles: Subtitles;
    export let currentStyle: SubtitleStyle;
    let refresh = 0;

	const dispatch = createEventDispatcher();
	const submit = () => dispatch('submit');
</script>

<svelte:options accessors={true} />

<select class='styleselect' tabindex='-1'
    on:input={(ev) => {
        let index = ev.currentTarget.selectedIndex;
        if (index <= 0) currentStyle = subtitles.defaultStyle;
        else currentStyle = subtitles.styles[index - 1];
        submit();
    }}
    on:click={() => refresh++}
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