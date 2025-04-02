<script lang="ts">
import StyleSelect from './StyleSelect.svelte';
import TimestampInput from './TimestampInput.svelte';

import { assert } from './Basic';
import { Labels, SubtitleEntry, type LabelTypes } from './core/Subtitles.svelte'
import { LabelColor } from './Theming.svelte';
import { tick } from 'svelte';
import { ChangeType, Source } from './frontend/Source';
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

Source.onSubtitlesChanged.bind(me, (type: ChangeType) => {
  editFormUpdateCounter++;
  console.log('changed', ChangeType[type]);
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

// function setupTextEditGUI(node: HTMLTextAreaElement, channel: SubtitleChannel) {
//   channel.gui = node;
//   node.value = channel.text;
//   return {
//     update: (newChannel: SubtitleChannel) => {
//       // note that svelte calls this every time the channel object changes in any way, but it's only relevant if it's really changing into ANOTHER one
//       if (newChannel != channel) {
//         channel.gui = undefined;
//         newChannel.gui = node;
//         node.value = newChannel.text;
//         channel = newChannel;
//       }
//     }
//   };
// }
</script>

<div class="outer hlayout">

<!-- timestamp fields -->
{#key `${editFormUpdateCounter}`}
<fieldset disabled={!(Editing.getFocusedEntry() instanceof SubtitleEntry)}>
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
    oninput={() => {
      if (editMode == 0 && keepDuration)
        editingT1 = editingT0 + editingDt;
      applyEditForm(); 
      Editing.editChanged = true;}} 
    onchange={() => 
      Source.markChanged(ChangeType.Times)}/>
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
      Source.markChanged(ChangeType.Times);}}/>
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
      Source.markChanged(ChangeType.Times)}/>
  <hr>
  <div class="hlayout">
    <div style={`height: auto; width: 25px; border: solid 1px;
      margin: 2px; background-color: ${LabelColor(editingLabel)}`}></div>
    <select
      bind:value={editingLabel}
      class="flexgrow"
      onchange={() => {
        applyEditForm();
        Source.markChanged(ChangeType.InPlace);}}>
      {#each Labels as color}
        <option value={color}>{color}</option>
      {/each}
    </select>
  </div>
</fieldset>
<!-- channels view -->
<div class="channels flexgrow isolated">
  {#if Editing.getFocusedEntry() instanceof SubtitleEntry}
  {@const focused = Editing.getFocusedEntry() as SubtitleEntry}
  <table class='fields'>
    <tbody>
      {#each Source.subs.styles as style, i}
      {#if focused.texts.has(style)}
      <tr>
        <td class="vlayout">
          <StyleSelect currentStyle={style}
            onsubmit={() => Source.markChanged(ChangeType.InPlace)} />
        </td>
        <td style='width:100%'>
          <textarea class='contentarea' tabindex=0
            value={focused.texts.get(style)!}
            onkeydown={(ev) => {
              if (ev.key == "Escape") {
                ev.currentTarget.blur();
                $uiFocus = UIFocus.Table;
              }
            }}
            onfocus={(ev) => {
              $uiFocus = UIFocus.EditingField;
              Editing.focused.style = style;
              Editing.focused.control = ev.currentTarget;
            }}
            onblur={(x) => {
              // TODO: this works but looks like nonsense
              if ($uiFocus === UIFocus.EditingField)
                $uiFocus = UIFocus.Other;
              Editing.submitFocusedEntry();
              Editing.focused.style = null;
            }}
            oninput={(x) => {
              $uiFocus = UIFocus.EditingField;
              contentSelfAdjust(x.currentTarget); 
              Editing.editChanged = true;
            }}></textarea>
        </td>
      </tr>
      {/if}
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
  padding: 5px;
  box-sizing: border-box;
}
</style>

