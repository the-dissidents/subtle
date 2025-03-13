<script lang="ts">
    import { createEventDispatcher, onDestroy } from "svelte";
    import type { SubtitleStyle } from "./core/Subtitles.svelte";
    import { ChangeType, Source } from "./frontend/Source";
    import { EventHost } from "./frontend/Frontend";

    interface Props {
        currentStyle: SubtitleStyle;
    }

    let { currentStyle = $bindable() }: Props = $props();
    let refresh = $state(0);
    let styles = $state(Source.subs.styles);

    const me = {};
    onDestroy(() => EventHost.unbind(me));

    Source.onSubtitlesChanged.bind(me, (t, c) => {
        if (t == ChangeType.StyleDefinitions || t == ChangeType.General)
            styles = Source.subs.styles;
    });

	const dispatch = createEventDispatcher();
	const submit = () => dispatch('submit');
</script>

<select class='styleselect' tabindex='-1'
    oninput={(ev) => {
        let index = ev.currentTarget.selectedIndex;
        if (index <= 0) currentStyle = Source.subs.defaultStyle;
        else currentStyle = styles[index - 1];
        submit();
    }}
    onclick={() => refresh++}
>
    {#key refresh}
    <option selected={currentStyle == Source.subs.defaultStyle}>
        {Source.subs.defaultStyle.name}
    </option>
    {#each styles as style (style.uniqueID)}
    <option selected={currentStyle == style}>{style.name}</option>
    {/each}
    {/key}
</select>

<style>
</style>