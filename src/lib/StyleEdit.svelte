<script lang="ts">
import { AlignMode, type SubtitleStyle, Subtitles } from "./core/Subtitles.svelte";
import { SubtitleTools } from "./core/SubtitleUtil.svelte";

import { Menu } from "@tauri-apps/api/menu";
import * as dialog from "@tauri-apps/plugin-dialog";
import { writable } from 'svelte/store';
import { ChangeType, Source } from "./frontend/Source";
import Collapsible from "./ui/Collapsible.svelte";

import { _ } from 'svelte-i18n';
import { Debug } from "./Debug";
import { Utils } from "./frontend/Utils";
import FilterEdit from "./FilterEdit.svelte";

interface Props {
  style: SubtitleStyle;
  subtitles: Subtitles;
  onsubmit?: () => void;
}

let { style: _style, subtitles = $bindable(), onsubmit }: Props = $props();
let alignSelector: HTMLSelectElement | undefined = $state();
let button: HTMLButtonElement | undefined = $state();
let duplicateWarning = $state(false);
let style = writable(_style);

function isDuplicate(name: string) {
  for (let s of subtitles.styles) {
    if (s === $style) continue;
    if (s.name == name) return true;
  }
  return false;
}

async function contextMenu() {
  let isDefault = $style == subtitles.defaultStyle;
  let used = subtitles.entries.filter((x) => x.texts.has($style));
  let withoutThis = subtitles.styles.filter((x) => x !== $style);
  
  let menu = await Menu.new({
    items: [
    {
      text: $_('style.delete'),
      enabled: used.length == 0,
      action() {
        if (isDefault) {
          dialog.message($_('msg.you-cant-delete-a-default-style'));
          return;
        }
        let i = subtitles.styles.indexOf($style);
        if (i < 0) return Debug.early('style not found');
        subtitles.styles.splice(i, 1);
        Source.markChanged(ChangeType.StyleDefinitions);
        onsubmit?.();
      }
    },
    {
      text: $_('style.duplicate'),
      action() {
        let clone = structuredClone($state.snapshot($style));
        clone.name = SubtitleTools.getUniqueStyleName(subtitles, $style.name);
        subtitles.styles.push(clone);
        // subtitles.styles = subtitles.styles;
        Source.markChanged(ChangeType.StyleDefinitions);
        onsubmit?.();
      }
    },
    {
      text: $_('style.replace-by'),
      enabled: Source.subs.styles.length > 1 && used.length > 0,
      items: withoutThis.map((x, i) => ({
        id: i.toString(),
        text: x.name,
        async action(id) {
          let n = Number.parseInt(id);
          let other = withoutThis[n];
          await Utils.replaceStyle(subtitles.entries, $style, other);
        }
      }))
    },
    {
      text: $_('style.exchange-with'),
      enabled: Source.subs.styles.length > 1 && used.length > 0,
      items: withoutThis.map((x, i) => ({
        id: i.toString(),
        text: x.name,
        action(id) {
          let n = Number.parseInt(id);
          let other = withoutThis[n];
          Utils.exchangeStyle(subtitles.entries, $style, other);
        }
      }))
    },
  ]});
  menu.popup();
}
</script>

<div class='hlayout'>
  <!-- toolbar -->
  <div class="toolbar">
    <!-- add style -->
    <button
      onclick={() => {
        const i = subtitles.styles.indexOf($style);
        Debug.assert(i >= 0);
        const name = SubtitleTools.getUniqueStyleName(subtitles, 'new');
        const newStyle = Subtitles.createStyle(name);
        subtitles.styles = subtitles.styles.toSpliced(i, 0, newStyle);
        Source.markChanged(ChangeType.StyleDefinitions);
        onsubmit?.();
      }}>+</button><br/>
    <!-- move up -->
    <button disabled={$style === subtitles.styles[0]}
      onclick={() => {
        const i = subtitles.styles.indexOf($style);
        Debug.assert(i >= 0);
        subtitles.styles = [
          ...subtitles.styles.slice(0, i-1), 
          $style, 
          subtitles.styles[i-1],
          ...subtitles.styles.slice(i+1)
        ];
        Source.markChanged(ChangeType.StyleDefinitions);
        onsubmit?.();
      }}>↑</button><br/>
    <!-- move down -->
    <button disabled={$style === subtitles.styles.at(-1)}
      onclick={() => {
        let i = subtitles.styles.indexOf($style);
        Debug.assert(i >= 0);
        subtitles.styles = [
          ...subtitles.styles.slice(0, i), 
          subtitles.styles[i+1],
          $style, 
          ...subtitles.styles.slice(i+2)
        ];
        Source.markChanged(ChangeType.StyleDefinitions);
        onsubmit?.();
      }}>↓</button><br/>
    <button bind:this={button} onclick={() => contextMenu()}>...</button>
  </div>
  <!-- properties -->
  <div class="flexgrow vlayout">
    <!-- basic -->
    <table class="stretch">
      <tbody>
        <tr>
          <td>{$_('style.name')}</td>
          <td class='hlayout'>
            <input type='text'
              value={$style.name}
              class={{duplicate: duplicateWarning, flexgrow: true}}
              oninput={(ev) => duplicateWarning = isDuplicate(ev.currentTarget.value)}
              onchange={(ev) => {
                if (isDuplicate(ev.currentTarget.value)) {
                  ev.currentTarget.value = $style.name;
                  duplicateWarning = false;
                } else {
                  $style.name = ev.currentTarget.value;
                  Source.markChanged(ChangeType.InPlace);
                }
              }}/>
            <label style="padding-left: 5px;">
              <input type='checkbox'
                checked={subtitles.defaultStyle == $style}
                onclick={(ev) => {
                  subtitles.defaultStyle = $style;
                  ev.currentTarget.checked = true;
                }}/>
              {$_('style.default')}
            </label>
          </td>
        </tr>
        <tr>
          <td>{$_('style.font')}</td>
          <td><input type="text" bind:value={$style.font}/></td>
        </tr>
        <tr>
          <td>{$_('style.size')}</td>
          <td class="hlayout style">
            <input type='number' bind:value={$style.size}/>
            <label><input type='checkbox' bind:checked={$style.styles.bold}/><b>B</b></label>
            <label><input type='checkbox' bind:checked={$style.styles.italic}/><i>I</i></label>
            <label><input type='checkbox' bind:checked={$style.styles.underline}/><u>U</u></label>
            <label><input type='checkbox' bind:checked={$style.styles.strikethrough}/><s>S</s></label>
          </td>
        </tr>
        <tr>
          <td></td>
          <td>
            <div class="flex style">
            </div>
          </td>
        </tr>
      </tbody>
    </table>
    <!-- validator -->
    <Collapsible header={$_('style.validator')}>
      <FilterEdit bind:filter={$style.validator} onchange={() => {
        Source.markChanged(ChangeType.Filter);
      }} />
    </Collapsible>
    <!-- advanced -->
    <Collapsible header={$_('style.more')}>
      <table class="stretch">
        <tbody>
          <tr>
            <td>{$_('style.text-color')}</td>
            <td><input type="text" bind:value={$style.color}/></td>
          </tr>
          <tr>
            <td>{$_('style.line-color')}</td>
            <td><input type="text" bind:value={$style.outlineColor}/></td>
          </tr>
          <tr>
            <td>{$_('style.line-size')}</td>
            <td><input type='number' bind:value={$style.outline}/></td>
          </tr>
          <tr>
            <td>{$_('style.shadow')}</td>
            <td><input type='number' bind:value={$style.shadow}/></td>
          </tr>
          <tr>
            <td>{$_('style.alignment')}</td>
            <td><select
                bind:this={alignSelector}
                value={AlignMode[$style.alignment]}
                oninput={() => $style.alignment = alignSelector!.selectedIndex + 1}>
              <option value="BottomLeft">{$_('style.bottom-left')}</option>
              <option value="BottomCenter">{$_('style.bottom-center')}</option>
              <option value="BottomRight">{$_('style.bottom-right')}</option>
              <option value="CenterLeft">{$_('style.center-left')}</option>
              <option value="Center">{$_('style.center')}</option>
              <option value="CenterRight">{$_('style.center-right')}</option>
              <option value="TopLeft">{$_('style.top-left')}</option>
              <option value="TopCenter">{$_('style.top-center')}</option>
              <option value="TopRight">{$_('style.top-right')}</option>
            </select></td>
          </tr>
          <tr>
            <td>{$_('style.margins')}</td>
            <td>
              <div class="flex margin">
                <div><label>{$_('style.top')}
                    <input type='number' bind:value={$style.margin.top}/>
                </label></div>
                <div><label>{$_('style.bottom')}
                  <input type='number' bind:value={$style.margin.bottom}/>
                </label></div>
                <div><label>{$_('style.left')}
                  <input type='number' bind:value={$style.margin.left}/>
                </label></div>
                <div><label>{$_('style.right')}
                  <input type='number' bind:value={$style.margin.right}/>
                </label></div>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </Collapsible>
  </div>
</div>

<style>
.duplicate {
  background-color: lightcoral;
}

.toolbar {
  text-align: right;
  vertical-align: top;
  padding-right: 10px;
}

.flex {
  display: flex;
  flex-wrap: wrap;
}

.stretch {
  width: 100%;
}

table td:first-child {
  font-size: 95%;
  white-space: nowrap;
  padding-right: 10px;
  /* text-transform: uppercase; */
  /* font-weight: bold; */
}

.style label {
  white-space: nowrap;
  padding-right: 5px;
  font-family: 'Times New Roman', Times, serif;
}

button {
  width: 25px;
  /* height: 20px; */
}

input {
  width: 100%;
}

input[type='checkbox'] {
  width: auto;
  margin-right: 5px;
}
.margin input {
  width: 60px;
}
.margin label {
  width: 50px;
  display: inline-block;
}
.margin div {
  padding-right: 15px;
}
</style>