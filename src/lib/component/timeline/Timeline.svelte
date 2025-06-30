<script lang='ts' module>
let rowPopup: PopupHandler = $state({});
let styleRefreshCounter = $state(0);
let buttonPosX = $state(0);
let buttonPosY = $state(0);
let uiFocus = Interface.uiFocus;

let layout = $state<TimelineLayout>();
let input = $state<TimelineInput>();
let renderer: TimelineRenderer;

</script>

<script lang="ts">
import { _ } from 'svelte-i18n';

import { ChangeType, Source } from "../../frontend/Source";
import { Interface } from '../../frontend/Interface';
import Popup, { type PopupHandler } from '../../ui/Popup.svelte';
import { TimelineLayout } from "./Layout";
import { TimelineInput, TimelineHandle } from "./Input.svelte";
import { TimelineRenderer } from "./Render.svelte";
import Tooltip from '../../ui/Tooltip.svelte';
import { Playback } from '../../frontend/Playback';
import { hook } from '../../details/Hook.svelte';
import { AlignCenterVerticalIcon, MagnetIcon, MousePointerIcon, PenLineIcon, PlusSquareIcon, ScissorsIcon } from '@lucide/svelte';

let currentMode = TimelineHandle.currentMode;
let useSnap = TimelineHandle.useSnap;
let lockCursor = TimelineHandle.lockCursor;

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

  Source.onSubtitleObjectReload.bind(layout, () => {
    styleRefreshCounter++;
  });
  Source.onSubtitlesChanged.bind(layout, (type) => {
    if (type == ChangeType.StyleDefinitions || type == ChangeType.General)
      styleRefreshCounter++;
  });

  uiFocus.subscribe((x) => {
    if (x != 'Timeline')
      TimelineHandle.useSnap.override = undefined;
  });

  hook(() => Playback.playArea.setting, 
       () => layout!.manager.requestRender());
}

function updateSnapOverride(ev: KeyboardEvent) {
  if ($uiFocus !== 'Timeline') return;
  TimelineHandle.useSnap.override = 
    ev.altKey ? !TimelineHandle.useSnap.setting : undefined;
}
</script>

<svelte:document
  on:keydown={updateSnapOverride}
  on:keyup={updateSnapOverride}/>

<div class={["hlayout", "container", {timelinefocused: $uiFocus === 'Timeline'}]}>
  <div class="vlayout toolbox">
    <Tooltip text={$_('timeline.select-tool')} position="right">
      <label>
        <input type="checkbox" class="button"
          checked={$currentMode == 'select'}
          onclick={() => $currentMode = 'select'} />
        <MousePointerIcon />
      </label>
    </Tooltip>
    <Tooltip text={$_('timeline.create-tool')} position="right">
      <label>
        <input type="checkbox" class="button"
          checked={$currentMode == 'create'}
          onclick={() => $currentMode = 'create'} />
        <PlusSquareIcon />
      </label>
    </Tooltip>
    <Tooltip text={$_('timeline.split-tool')} position="right">
      <label>
        <input type="checkbox" class="button"
          checked={$currentMode == 'split'}
          onclick={() => $currentMode = 'split'} />
        <ScissorsIcon />
      </label>
    </Tooltip>

    <hr/>

    <Tooltip text={$_('timeline.enable-snap')} position="right">
      <label>
        <input type="checkbox" class="button"
          checked={$useSnap}
          onclick={() => useSnap.setting = !useSnap.setting} />
        <MagnetIcon />
      </label>
    </Tooltip>
    <Tooltip text={$_('timeline.lock-cursor')} position="right">
      <label>
        <input type="checkbox" class="button"
          checked={$lockCursor}
          onclick={() => lockCursor.set(!lockCursor.get())} />
        <AlignCenterVerticalIcon />
      </label>
    </Tooltip>
  </div>

  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="overlay-container"
      onclick={() => $uiFocus = 'Timeline'}>
    <div class="button-container"
        style:width="{buttonPosX}px">
      <button aria-label='edit'
        style:top="{buttonPosY}px"
        onclick={(ev) => {
          const rect = ev.currentTarget.getBoundingClientRect();
          rowPopup.open!(rect);
        }}
      >
        <PenLineIcon />
      </button>
    </div>
    <canvas class="timeline fill" use:setup>
    </canvas>
  </div>
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
  display: block;
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

.toolbox {
  padding: 0 3px 0 3px;
  justify-items: end;
}

.container {
  width: 100%;
  height: 100%;
  border-radius: 4px;
  overflow: hidden;
  /* background-color: gray; */
}

.overlay-container {
  position: relative;
  width: 100%;
}
</style>