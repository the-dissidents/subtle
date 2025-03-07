<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import type { SubtitleStyle, Subtitles } from "./core/Subtitles.svelte";
    import { ChangeType, type Frontend } from "./Frontend";

    interface Props {
        frontend: Frontend;
        currentStyle: SubtitleStyle;
    }

    let { frontend, currentStyle = $bindable() }: Props = $props();
    let refresh = $state(0);
    let styles = $state(frontend.subs.styles);

    frontend.onSubtitlesChanged.bind((t, c) => {
    if (t == ChangeType.StyleDefinitions || t == ChangeType.General)
        styles = frontend.subs.styles;
    });

	const dispatch = createEventDispatcher();
	const submit = () => dispatch('submit');
</script>

<select class='styleselect' tabindex='-1'
    oninput={(ev) => {
        let index = ev.currentTarget.selectedIndex;
        if (index <= 0) currentStyle = frontend.subs.defaultStyle;
        else currentStyle = styles[index - 1];
        submit();
    }}
    onclick={() => refresh++}
>
    {#key refresh}
    <option selected={currentStyle == frontend.subs.defaultStyle}>
        {frontend.subs.defaultStyle.name}
    </option>
    {#each styles as style (style.uniqueID)}
    <option selected={currentStyle == style}>{style.name}</option>
    {/each}
    {/key}
</select>

<style>
</style>