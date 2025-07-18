<script lang="ts">
import LabelSelect from './LabelSelect.svelte';
import StyleSelect from './StyleSelect.svelte';
import TimestampInput from './TimestampInput.svelte';
import { EllipsisIcon, PlusIcon } from '@lucide/svelte';

import { SubtitleEntry, type LabelType, type SubtitleStyle } from './core/Subtitles.svelte';
import { Editing } from './frontend/Editing';
import { ChangeType, Source } from './frontend/Source';
import { Frontend } from './frontend/Frontend';

import { Menu } from '@tauri-apps/api/menu';
import * as dialog from "@tauri-apps/plugin-dialog";
import { tick } from 'svelte';
import { _ } from 'svelte-i18n';
import { Debug } from './Debug';

let editFormUpdateCounter = $state(0);
let editMode = $state(0);
let keepDuration = $state(false);
let editingT0 = $state(0);
let editingT1 = $state(0);
let editingDt = $state(0);
let editingLabel: LabelType = $state('none');
let uiFocus = Frontend.uiFocus;
let focusedStyle = Editing.focused.style;

const me = {};

Source.onSubtitlesChanged.bind(me, (type: ChangeType) => {
  editFormUpdateCounter++;
  Debug.debug(`changed - ${ChangeType[type]}`);
});

Editing.onSelectionChanged.bind(me, () => {
  editFormUpdateCounter++;
  let focused = Editing.getFocusedEntry();
  if (focused instanceof SubtitleEntry) {
    editingT0 = focused.start;
    editingT1 = focused.end;
    editingDt = editingT1 - editingT0;
    editingLabel = focused.label;
    let isEditingNow = Frontend.getUIFocus() == 'EditingField';
    tick().then(() => {
      let col = document.getElementsByClassName('contentarea');
      for (const target of col) {
        contentSelfAdjust(target as HTMLTextAreaElement);
      }
      if (isEditingNow) Editing.startEditingFocusedEntry();
    });
  }
});

function applyEditForm() {
  let focused = Editing.getFocusedEntry();
  Debug.assert(focused instanceof SubtitleEntry);
  focused.start = editingT0;
  focused.end = editingT1;
  editingDt = editingT1 - editingT0;
  focused.label = editingLabel;
}

function contentSelfAdjust(elem: HTMLTextAreaElement) {
  elem.style.height = "auto";
  elem.style.height = `${elem.scrollHeight + 3}px`; // grows to fit content
}

function setupTextArea(node: HTMLTextAreaElement, style: SubtitleStyle) {
  const state = Source.subs.styles.find((x) => x.name == style.name);
  Debug.assert(state !== undefined);
  Editing.styleToEditor.set(state, node);
  return {
    update: (style: SubtitleStyle) => {
      const state = Source.subs.styles.find((x) => x.name == style.name);
      Debug.assert(state !== undefined);
      Editing.styleToEditor.set(state, node);
    }
  };
}
</script>

<div class="outer hlayout">

<!-- timestamp fields -->
{#key `${editFormUpdateCounter}`}
<fieldset disabled={!(Editing.getFocusedEntry() instanceof SubtitleEntry)}>
  <span class="hlayout center-items">
    <select
      oninput={(ev) => editMode = ev.currentTarget.selectedIndex}>
      <option>{$_('editbox.anchor-start')}</option>
      <option>{$_('editbox.anchor-end')}</option>
    </select>
    <input type='checkbox' id='keepd' bind:checked={keepDuration}/>
    <label for='keepd'>{$_('editbox.keep-duration')}</label>
  </span>
  <TimestampInput bind:timestamp={editingT0}
    stretch={true}
    oninput={() => {
      if (editMode == 0 && keepDuration)
        editingT1 = editingT0 + editingDt;
      applyEditForm(); 
      Editing.editChanged = true;}} 
    onchange={() => 
      Source.markChanged(ChangeType.Times, $_('c.timestamp'))}/>
  <br>
  <TimestampInput bind:timestamp={editingT1}
    stretch={true}
    oninput={() => {
      if (editMode == 1 && keepDuration)
        editingT0 = editingT1 - editingDt;
      applyEditForm(); 
      Editing.editChanged = true;}} 
    onchange={() => {
      if (editingT1 < editingT0) editingT1 = editingT0;
      applyEditForm();
      Source.markChanged(ChangeType.Times, $_('c.timestamp'));}}/>
  <br>
  <TimestampInput bind:timestamp={editingDt}
    stretch={true}
    oninput={() => {
      if (editMode == 0)
        editingT1 = editingT0 + editingDt; 
      else if (editMode == 1)
        editingT0 = editingT1 - editingDt; 
      applyEditForm();
      Editing.editChanged = true;}}
    onchange={() => 
      Source.markChanged(ChangeType.Times, $_('c.timestamp'))}/>
  <hr>
  <label class="hlayout center-items">
    <span style="padding-right: 5px; white-space: pre;">
      {$_('editbox.label')}
    </span>
    <LabelSelect 
      bind:value={editingLabel}
      stretch={true}
      onsubmit={() => {
        applyEditForm();
        Source.markChanged(ChangeType.InPlace, $_('c.label'));
      }}/>
  </label>
</fieldset>
<!-- channels view -->
<div class="channels flexgrow isolated">
  {#if Editing.getFocusedEntry() instanceof SubtitleEntry}
  {@const focused = Editing.getFocusedEntry() as SubtitleEntry}
  <table class='fields'>
    <tbody>
      {#each Source.subs.styles as style}
      {#if focused.texts.has(style)}
      <tr>
        <td class={{selected: style.name == $focusedStyle?.name, vlayout: true}}>
          <StyleSelect currentStyle={style}
            onsubmit={async (newStyle, cancel) => {
              if (focused.texts.has(newStyle) && !await dialog.confirm(
                  $_('msg.overwrite-style', {values: {style: newStyle.name}}))) {
                cancel();
                return;
              }
              focused.texts.set(newStyle, focused.texts.get(style)!);
              focused.texts.delete(style);
              Source.markChanged(ChangeType.InPlace, $_('c.change-style'));
            }} />
          <button onclick={async () => {
            let otherUsed = [...focused.texts.keys()].filter((x) => x !== style);
            const menu = await Menu.new({
              items: [
                {
                  text: $_('action.exchange-channel'),
                  enabled: Source.subs.styles.length > 1,
                  items: otherUsed.map((x, i) => ({
                    id: i.toString(),
                    text: x.name,
                    action() {
                      let textA = focused.texts.get(style);
                      let textB = focused.texts.get(x);
                      Debug.assert(textA !== undefined && textB !== undefined);
                      focused.texts.set(x, textA);
                      focused.texts.set(style, textB);
                      Source.markChanged(ChangeType.InPlace, $_('c.exchange-channel'));
                    }
                  }))
                },
                {
                  text: $_('style.delete'),
                  enabled: focused.texts.size > 1,
                  action() {
                    Editing.deleteChannel(style);
                  }
                }
              ]
            });
            menu.popup();
          }}><EllipsisIcon /></button>
        </td>
        <td style='width:100%'>
          <textarea class='contentarea' tabindex=0
            use:setupTextArea={style}
            value={focused.texts.get(style)!}
            onfocus={(ev) => {
              $uiFocus = 'EditingField';
              Editing.focused.style.set(style);
              Editing.focused.control = ev.currentTarget;
            }}
            onblur={(x) => {
              if ($uiFocus === 'EditingField')
                $uiFocus = 'Other';
              Editing.submitFocusedEntry();
            }}
            oninput={(x) => {
              $uiFocus = 'EditingField';
              contentSelfAdjust(x.currentTarget);
              Editing.editChanged = true;
            }}></textarea>
        </td>
      </tr>
      {/if}
      {/each}
      <tr>
        <td class="vlayout">
          <button 
            onclick={async () => {
              const menu = await Menu.new({
                items: Source.subs.styles.filter((x) => !focused.texts.has(x)).map((x) => ({
                  text: x.name,
                  action: () => Editing.insertChannel(x)
                }))
              });
              menu.popup();
            }}
          ><PlusIcon />
          </button>
        </td>
      </tr>
    </tbody>
  </table>
  {:else}
  <div class="fill hlayout" style="justify-content: center; align-items: center;">
    <i>{Editing.getFocusedEntry() == 'virtual'
      ? $_('editbox.at-virtual-entry')
      : $_('editbox.no-selection')}</i>
  </div>
  {/if}
</div>
{/key}
  
</div>

<style>
.outer {
  width: 100%;
  height: 100%;
}

.channels {
  overflow: auto;
  box-shadow: gray 0px 0px 3px inset;
  border-radius: 3px;
  margin-left: 3px;
}

.contentarea {
  width: 100%;
  resize: none;
  overflow: visible;
  box-sizing: border-box;
  font-family: var(--editorFontFamily);
  font-size: var(--editorFontSize);
}

td {
  padding: 3px;
  border-radius: 3px;
}


@media (prefers-color-scheme: light) {
  .selected {
    background-color: var(--uchu-pink-2);
  }
}

@media (prefers-color-scheme: dark) {
  .selected {
    background-color: var(--uchu-blue-9);
  }
}
</style>

