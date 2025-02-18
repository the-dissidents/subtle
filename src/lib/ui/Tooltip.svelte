<script lang="ts">
    type TooltipPosition = 'top' | 'bottom' | 'left' | 'right';
    interface Props {
        position?: TooltipPosition;
        text?: string;
        children?: import('svelte').Snippet;
    }

    let { position = 'top', text = '<Tooltip>', children }: Props = $props();
</script>

<style>
    :has(:global(> .tooltip)) {
        /* display: contents; */
        position: relative;
    }
    .tooltip {
        visibility: hidden;
        width: 200px;

        background-color: black;
        color: #fff;
        text-align: center;
        padding: 5px;
        border-radius: 6px;
        position: absolute;
        z-index: 9999;
    }
    :hover + .tooltip {
        visibility: visible;
    }
    .right {
        top: -5px;
        left: calc(100% + 5px);
        transform: translate(0, -25%);
    }
    .left {
        top: -5px;
        right: calc(100% + 5px);
        transform: translate(0, -25%);
    }
    .top {
        bottom: 100%;
        left: 50%;
        transform: translate(-50%, 0);
    }
    .bottom {
        top: 100%;
        left: 50%;
        transform: translate(-50%, 0);
    }
</style>

<div>
    <div>
        {@render children?.()}
    </div>
    {#if text != ''}
    <span class='tooltip {position}'>{text}</span>
    {/if}
</div>