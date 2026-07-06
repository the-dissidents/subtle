<script lang="ts">
import { Debug } from './Debug';

import LabelSelect from './LabelSelect.svelte';
import StyleSelect from './StyleSelect.svelte';
import TimestampInput from './TimestampInput.svelte';

import RichEdit from './component/richedit/RichEdit.svelte';
import RichEditToolbar from './component/richedit/RichEditToolbar.svelte';

import { SubtitleEntry, type Positioning } from './core/Subtitles.svelte';
import { AlignMode, type LabelType } from "./core/Labels";
import { CompiledLintProfile } from './core/LintProfile';

import { Editing } from './frontend/Editing';
import { ChangeType, Source } from './frontend/Source';
import { Frontend } from './frontend/Frontend';

import { NumberInput } from '@the_dissidents/svelte-ui';
import { EllipsisIcon, PlusIcon } from '@lucide/svelte';
import * as dialog from "@tauri-apps/plugin-dialog";
import { Menu } from '@tauri-apps/api/menu';

import { _ } from 'svelte-i18n';
import { tick } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';

let editFormUpdateCounter = $state(0);
let editAnchor: 'start' | 'end' = $state('start');
let keepDuration = $state(false);
let editingT0 = $state(0);
let editingT1 = $state(0);
let editingDt = $state(0);
let editingPos: Positioning = $state(null);
let editingAlign: AlignMode | null = $state(null);
let editingLabel: LabelType = $state('none');
let uiFocus = Frontend.uiFocus;

let focusedEntry = Editing.focused.entry;
let focusedStyle = Editing.focused.style;

function updateLinters() {
  return new SvelteMap(Source.subs.styles.map(
    (x) => [x, x.lintProfile ? new CompiledLintProfile(x.lintProfile) : undefined] as const));
}

let linters = $state(updateLinters());

const me = {};

Source.onSubtitlesChanged.bind(me, (type) => {
  if (type == ChangeType.General || type == ChangeType.LintProfile) {
    linters = updateLinters();
    void Debug.debug('linters updated');
  }
  updateForm();
});

Source.onSubtitleObjectReload.bind(me, () => {
  editFormUpdateCounter++;
});

Editing.onSelectionChanged.bind(me, () => {
  editFormUpdateCounter++;
  const focused = Editing.getFocusedEntry();
  if (focused instanceof SubtitleEntry) {
    updateForm();
    if ($uiFocus == 'EditingField')
      void tick().then(() => Editing.startEditingFocusedEntry());
  }
});

function updateForm() {
  let focused = Editing.getFocusedEntry();
  if (!(focused instanceof SubtitleEntry)) return;
  editingT0 = focused.start;
  editingT1 = focused.end;
  editingDt = editingT1 - editingT0;
  editingLabel = focused.label;
  editingPos = focused.positioning;
  editingAlign = focused.alignment;
}

function applyEditForm() {
  let focused = Editing.getFocusedEntry();
  Debug.assert(focused instanceof SubtitleEntry);
  focused.start = editingT0;
  focused.end = editingT1;
  editingDt = editingT1 - editingT0;
  focused.label = editingLabel;
  focused.positioning = editingPos;
  focused.alignment = editingAlign;
}

</script>

<div class="outer hlayout">

<!-- timestamp fields -->
{#key `${editFormUpdateCounter}`}
<fieldset class="vlayout"
    disabled={!(Editing.getFocusedEntry() instanceof SubtitleEntry)}>
  <span class="hlayout center-items">
    <select bind:value={editAnchor}>
      <option value="start">{$_('editbox.anchor-start')}</option>
      <option value="end">{$_('editbox.anchor-end')}</option>
    </select>
    <input type='checkbox' id='keepd' bind:checked={keepDuration}/>
    <label for='keepd'>{$_('editbox.keep-duration')}</label>
  </span>
  <TimestampInput bind:timestamp={editingT0}
    oninput={() => {
      if (editAnchor == 'start' && keepDuration)
        editingT1 = editingT0 + editingDt;
      applyEditForm();
    }}
    onchange={() =>
      Source.markChanged(ChangeType.Times, $_('c.timestamp'))}/>
  <TimestampInput bind:timestamp={editingT1}
    oninput={() => {
      if (editAnchor == 'end' && keepDuration)
        editingT0 = editingT1 - editingDt;
      applyEditForm();
    }}
    onchange={async () => {
      if (editingT1 < editingT0) editingT1 = editingT0;
      applyEditForm();
      await Source.markChanged(ChangeType.Times, $_('c.timestamp'));
    }}/>
  <TimestampInput bind:timestamp={editingDt}
    oninput={() => {
      if (editAnchor == 'start')
        editingT1 = editingT0 + editingDt;
      else if (editAnchor == 'end')
        editingT0 = editingT1 - editingDt;
      else
        Debug.never(editAnchor);
      applyEditForm();
    }}
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
      onsubmit={async () => {
        applyEditForm();
        await Source.markChanged(ChangeType.InPlace, $_('c.label'));
      }}/>
  </label>
  <hr>
  <label>
    <input type="checkbox" checked={!!editingPos}
      onchange={async (x) => {
        if (x.currentTarget.checked)
          editingPos = { type: 'absolute', x: 0, y: 0 };
        else
          editingPos = null;
        applyEditForm();
        await Source.markChanged(ChangeType.InPlace, $_('c.positioning'));
      }}>
    {$_('editbox.custom-positioning')}
  </label>
  {#if !!editingPos}
  <div class="hlayout">
    <NumberInput bind:value={editingPos.x} min="0" max="10000" style="flex-grow:1"
      onchange={() => Source.markChanged(ChangeType.InPlace, $_('c.positioning'))} />
    <NumberInput bind:value={editingPos.y} min="0" max="10000" style="flex-grow:1"
      onchange={() => Source.markChanged(ChangeType.InPlace, $_('c.positioning'))} />
  </div>
  {/if}
  <hr>
  <label>
    <input type="checkbox" checked={!!editingAlign}
      onchange={async (x) => {
        if (x.currentTarget.checked && editingAlign == null)
          editingAlign = $focusedStyle?.alignment ?? AlignMode.BottomCenter;
        if (!x.currentTarget.checked)
          editingAlign = null;
        applyEditForm();
        await Source.markChanged(ChangeType.InPlace, $_('c.custom-alignment'));
      }}>
    {$_('editbox.custom-alignment')}
  </label>
  {#if !!editingAlign}
    <select
        value={AlignMode[editingAlign]}
        oninput={async (x) => {
          editingAlign = x.currentTarget.selectedIndex + 1;
          applyEditForm();
          await Source.markChanged(ChangeType.InPlace, $_('c.custom-alignment'));
        }}>
      <option value="BottomLeft">{$_('style.bottom-left')}</option>
      <option value="BottomCenter">{$_('style.bottom-center')}</option>
      <option value="BottomRight">{$_('style.bottom-right')}</option>
      <option value="CenterLeft">{$_('style.center-left')}</option>
      <option value="Center">{$_('style.center')}</option>
      <option value="CenterRight">{$_('style.center-right')}</option>
      <option value="TopLeft">{$_('style.top-left')}</option>
      <option value="TopCenter">{$_('style.top-center')}</option>
      <option value="TopRight">{$_('style.top-right')}</option>
    </select>
  {/if}
</fieldset>
<!-- channels view -->
<div class="vlayout channels flexgrow isolated area" class:focused={$uiFocus == 'EditingField'}>
  <RichEditToolbar
    target={$focusedStyle ? Editing.styleToEditor.get($focusedStyle) : undefined}
    onAction={() => Editing.submitFocusedEntry()} />

  {#if $focusedEntry instanceof SubtitleEntry}
  {@const focused = $focusedEntry}
  <table class='fields'>
    <tbody>
      {#each Source.subs.styles as style (style.name)}
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
              await Source.markChanged(ChangeType.InPlace, $_('c.change-style'));
            }} />
          <button tabindex="-1" onclick={async () => {
            let otherUsed = [...focused.texts.keys()].filter((x) => x !== style);
            const menu = await Menu.new({
              items: [
                {
                  text: $_('action.exchange-channel'),
                  enabled: Source.subs.styles.length > 1,
                  items: otherUsed.map((x, i) => ({
                    id: i.toString(),
                    text: x.name,
                    async action() {
                      let textA = focused.texts.get(style);
                      let textB = focused.texts.get(x);
                      Debug.assert(textA !== undefined && textB !== undefined);
                      focused.texts.set(x, textA);
                      focused.texts.set(style, textB);
                      await Source.markChanged(ChangeType.InPlace, $_('c.exchange-channel'));
                    }
                  }))
                },
                {
                  text: $_('style.delete'),
                  enabled: focused.texts.size > 1,
                  // eslint-disable-next-line @typescript-eslint/no-misused-promises
                  async action() { await Editing.deleteChannel(style); }
                }
              ]
            });
            await menu.popup();
          }}><EllipsisIcon /></button>
        </td>
        <td style='width:100%'>
          <RichEdit text={focused.texts.get(style)!}
            bind:this={
              () => Editing.styleToEditor.get(style),
              (x) => Editing.styleToEditor.set(style, x)
            }
            linter={linters.get(style)}
            deinit={() => Editing.styleToEditor.delete(style)}
            onFocus={() => {
              const self = Editing.styleToEditor.get(style);
              Debug.assert(!!self);
              $uiFocus = 'EditingField';
              Editing.focused.style.set(style);
              // void Debug.trace('focused style set to', style.name);
              Editing.focused.control = self;
            }}
            onBlur={async (text) => {
              if ($uiFocus === 'EditingField')
                $uiFocus = 'Other';
              if (Editing.editChanged)
                await Editing.submitEntry(focused, style, text);
            }}
            onInput={() => {
              $uiFocus = 'EditingField';
              Editing.editChanged = true;
            }}
          />
        </td>
      </tr>
      {/if}
      {/each}
      <tr>
        <td class="vlayout">
          <button
            disabled={Source.subs.styles.find((x) => !focused.texts.has(x)) === undefined}
            onclick={async () => (await Menu.new({
                items: Source.subs.styles
                  .filter((x) => !focused.texts.has(x))
                  .map((x) => ({
                    text: x.name,
                    action: () => Editing.insertChannel(x)
                  }))
              })).popup()}
          ><PlusIcon />
          </button>
        </td>
      </tr>
    </tbody>
  </table>
  {:else}
  <div class="flexgrow hlayout hint">
    <i>{Editing.getFocusedEntry() == 'virtual'
      ? $_('editbox.at-virtual-entry')
      : $_('editbox.no-selection')}</i>
  </div>
  {/if}
</div>
{/key}

</div>

<style lang='scss'>
.outer {
  width: 100%;
  height: 100%;
}

fieldset {
  overflow-y: scroll;
}

.channels {
  overflow-x: hidden;
  overflow-y: scroll;
  /* box-shadow: gray 0px 0px 3px inset; */
  border: solid var(--uchu-gray-2) 1px;
  margin-left: 3px;

  @media (prefers-color-scheme: dark) {
    border-color: var(--uchu-yin-7);
  }
}

:global(.ProseMirror.ProseMirror) {
  width: 100%;
  resize: none;
  overflow: visible;
  box-sizing: border-box;
  font-family: var(--editorFontFamily);
  font-size: var(--editorFontSize);
  min-height: 2lh;
}

td {
  padding: 3px;
  border-radius: 3px;
}

.hint {
  color: var(--disabled-text-light);
  justify-content: center;
  align-items: center;
  font-weight: bold;
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
  .hint {
    color: var(--disabled-text-dark);
  }
}
</style>

