<script lang="ts">
import * as _i18n from './i18n';

import StyleSelect from './StyleSelect.svelte';
import TimestampInput from './TimestampInput.svelte';

import { assert } from './Basic';
import { Labels, SubtitleEntry, type LabelTypes, type SubtitleChannel } from './core/Subtitles.svelte'
import { LabelColor } from './Theming';
import { tick } from 'svelte';
import { ChangeCause, ChangeType, Source } from './frontend/Source';
import { Editing } from './frontend/Editing';
import { Interface, UIFocus } from './frontend/Interface';

import { _ } from 'svelte-i18n';

let editFormUpdateCounter = $state(0);
let editMode = $state(0);
let keepDuration = $state(false);
let editingT0 = $state(0);
let editingT1 = $state(0);
let editingDt = $state(0);
let editingLabel: LabelTypes = $state('none');
let uiFocus = Interface.uiFocus;

const me = {};

Source.onSubtitlesChanged.bind(me, (type: ChangeType, cause: ChangeCause) => {
  // for toolbar
  if (cause != ChangeCause.UIForm)
    editFormUpdateCounter++;
  console.log('changed', ChangeType[type], ChangeCause[cause]);
});

Editing.onSelectionChanged.bind(me, () => {
  editFormUpdateCounter++;
  let focused = Editing.getFocusedEntry();
  if (focused instanceof SubtitleEntry) {
    editingT0 = focused.start;
    editingT1 = focused.end;
    editingDt = editingT1 - editingT0;
    editingLabel = focused.label;
    let isEditingNow = Interface.getUIFocus() == UIFocus.EditingField;
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
  assert(focused instanceof SubtitleEntry);
  focused.start = editingT0;
  focused.end = editingT1;
  editingDt = editingT1 - editingT0;
  focused.label = editingLabel;
}

function contentSelfAdjust(elem: HTMLTextAreaElement) {
  elem.style.height = "auto";
  elem.style.height = `${elem.scrollHeight + 3}px`; // grows to fit content
}

function setupTextEditGUI(node: HTMLTextAreaElement, channel: SubtitleChannel) {
  channel.gui = node;
  node.value = channel.text;
  return {
    update: (newChannel: SubtitleChannel) => {
      // note that svelte calls this every time the channel object changes in any way, but it's only relevant if it's really changing into ANOTHER one
      if (newChannel != channel) {
        channel.gui = undefined;
        newChannel.gui = node;
        node.value = newChannel.text;
        channel = newChannel;
      }
    }
  };
}
</script>

<div class="outer hlayout">

<!-- timestamp fields -->
{#key `${editFormUpdateCounter}`}
<div>
  <span>
    <select
      oninput={(ev) => editMode = ev.currentTarget.selectedIndex}>
      <option>{$_('editbox.anchor-start')}</option>
      <option>{$_('editbox.anchor-end')}</option>
    </select>
    <input type='checkbox' id='keepd' bind:checked={keepDuration}/>
    <label for='keepd'>{$_('editbox.keep-duration')}</label>
  </span>
  <br>
  <TimestampInput bind:timestamp={editingT0}
    stretch={true}
    on:input={() => {
      if (editMode == 0 && keepDuration)
        editingT1 = editingT0 + editingDt;
      applyEditForm(); 
      Editing.editChanged = true;}} 
    on:change={() => 
      Source.markChanged(ChangeType.Times, ChangeCause.UIForm)}/>
  <br>
  <TimestampInput bind:timestamp={editingT1}
    stretch={true}
    on:input={() => {
      if (editMode == 1 && keepDuration)
        editingT0 = editingT1 - editingDt;
      applyEditForm(); 
      Editing.editChanged = true;}} 
    on:change={() => {
      if (editingT1 < editingT0) editingT1 = editingT0;
      applyEditForm();
      Source.markChanged(ChangeType.Times, ChangeCause.UIForm);}}/>
  <br>
  <TimestampInput bind:timestamp={editingDt}
    stretch={true}
    on:input={() => {
      if (editMode == 0)
        editingT1 = editingT0 + editingDt; 
      else if (editMode == 1)
        editingT0 = editingT1 - editingDt; 
      applyEditForm();
      Editing.editChanged = true;}}
    on:change={() => 
      Source.markChanged(ChangeType.Times, ChangeCause.UIForm)}/>
  <hr>
  <div class="hlayout">
    <div style={`height: auto; width: 25px; border: solid 1px;
      margin: 2px; background-color: ${LabelColor(editingLabel)}`}></div>
    <select
      bind:value={editingLabel}
      class="flexgrow"
      onchange={() => {
        applyEditForm();
        Source.markChanged(ChangeType.InPlace, ChangeCause.UIForm);}}>
      {#each Labels as color}
        <option value={color}>{color}</option>
      {/each}
    </select>
  </div>
</div>
<!-- channels view -->
<div class="channels flexgrow isolated">
  {#if Editing.getFocusedEntry() instanceof SubtitleEntry}
  {@const focused = Editing.getFocusedEntry() as SubtitleEntry}
  <table class='fields'>
    <tbody>
      {#each focused.texts as line, i}
      <tr>
        <td class="vlayout">
          <StyleSelect bind:currentStyle={line.style}
            on:submit={() => {
              Source.markChanged(ChangeType.InPlace, ChangeCause.UIForm)}} />
          <div class="hlayout">
            <button tabindex='-1' class="flexgrow"
              onclick={() => Editing.insertChannelAt(i)}>+</button>
            <button tabindex='-1' class="flexgrow"
              onclick={() => Editing.deleteChannelAt(i)}
              disabled={focused.texts.length == 1}>-</button>
          </div>
        </td>
        <td style='width:100%'>
          <textarea class='contentarea' tabindex=0
            use:setupTextEditGUI={line}
            onkeydown={(ev) => {
              if (ev.key == "Escape") {
                ev.currentTarget.blur();
                $uiFocus = UIFocus.Table;
              }
            }}
            onfocus={() => {
              $uiFocus = UIFocus.EditingField;
              Editing.focused.channel = line;
              Editing.focused.style = line.style;
            }}
            onblur={(x) => {
              // TODO: this works but looks like nonsense
              if ($uiFocus === UIFocus.EditingField)
                $uiFocus = UIFocus.Other;
              Editing.submitFocusedEntry();
              Editing.focused.channel = null;
            }}
            oninput={(x) => {
              $uiFocus = UIFocus.EditingField;
              contentSelfAdjust(x.currentTarget); 
              Editing.editChanged = true;
            }}></textarea>
        </td>
      </tr>
      {/each}
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
  padding: 0 3px;
  margin-left: 3px;
}

.contentarea {
  width: 100%;
  resize: none;
  overflow: visible;
  border-radius: 2px;
  border: 1px solid gray;
  padding: 5px;
  box-sizing: border-box;
}
</style>

