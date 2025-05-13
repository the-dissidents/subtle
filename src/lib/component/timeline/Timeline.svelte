<script lang="ts">
import { _ } from 'svelte-i18n';

import { ChangeType, Source } from "../../frontend/Source";
import { Interface } from '../../frontend/Interface';
import Popup, { type PopupHandler } from '../../ui/Popup.svelte';
import { TimelineLayout } from "./Layout";
import { TimelineInput } from "./Input";
import { TimelineRenderer } from "./Render.svelte";

let rowPopup: PopupHandler = $state({});
let styleRefreshCounter = $state(0);
let buttonPosX = $state(0);
let buttonPosY = $state(0);
let uiFocus = Interface.uiFocus;

let layout = $state<TimelineLayout>();
let input: TimelineInput;
let renderer: TimelineRenderer;

// Setup function for the canvas
function setup(canvas: HTMLCanvasElement) {
  layout = new TimelineLayout(canvas);
  input = new TimelineInput(layout);
  renderer = new TimelineRenderer(layout, input);

  layout.onLayout.bind(layout, () => {
    buttonPosX = layout!.leftColumnWidth - TimelineLayout.LEFT_COLUMN_MARGIN;
  });
  layout.manager.onUserScroll.bind(layout, () => {
    buttonPosY = -layout!.manager.scroll[1];
  });
}

</script>

<div class="container">
  <div class="button-container"
       style:width="{buttonPosX}px">
    <button aria-label='edit'
      style:top="{buttonPosY}px"
      onclick={(ev) => {
        const rect = ev.currentTarget.getBoundingClientRect();
        rowPopup.open!(rect);
      }}
    >
      <svg class="feather">
        <use href={`/feather-sprite.svg#edit-3`} />
      </svg>
    </button>
  </div>
  <canvas class="timeline fill"
    use:setup
    onclick={() => $uiFocus = 'Timeline'}
    class:timelinefocused={$uiFocus === 'Timeline'}>
  </canvas>
</div>

<Popup bind:handler={rowPopup} position="right">
  <div class="vlayout">
    <h5>
      {$_('timeline.filter-styles')}
    </h5>
    {#key styleRefreshCounter}
    {@const exclude = Source.subs.view.timelineExcludeStyles}
    {#each Source.subs.styles as style}
      <label>
        <input type="checkbox"
          checked={!exclude.has(style)}
          disabled={!exclude.has(style) && exclude.size >= Source.subs.styles.length - 1}
          onchange={(ev) => {
            if (ev.currentTarget.checked)
              exclude.delete(style);
            else
              exclude.add(style);
            layout!.requestedLayout = true;
            Source.markChanged(ChangeType.View);
          }} />
        {style.name}
      </label>
    {/each}
    {/key}
  </div>
</Popup>

<style>
@media (prefers-color-scheme: light) {
  canvas.timeline {
    background-color: var(--uchu-gray-1);
  }
  .timelinefocused {
    box-shadow: 0 5px 10px gray;
  }
}

@media (prefers-color-scheme: dark) {
  canvas.timeline {
    background-color: black;
  }
  .timelinefocused {
    box-shadow: 0 5px 10px gray;
  }
}

h5 {
  padding-top: 0;
}

.timeline {
  border-radius: 4px;
  display: block;
  background-color: gray;
  user-select: none; -webkit-user-select: none;
  -moz-user-select: none; -ms-user-select: none;
}

.button-container {
  position: absolute;
  left: 0;
  top: 0;
  margin: 0;
  height: 100%;
  overflow: hidden;
  pointer-events: none;
}
.button-container button {
  position: absolute;
  top: 0;
  right: 0;
  margin-right: 0;
  margin-top: 2px;
  pointer-events: auto;
}

.container {
  position: relative;
  width: 100%;
  height: 100%;
}
</style>