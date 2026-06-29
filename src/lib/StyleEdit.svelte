<script lang="ts">
import { ArrowDown, ArrowUp, MoreHorizontalIcon, PlusIcon } from "@lucide/svelte";
import { Menu } from "@tauri-apps/api/menu";
import * as dialog from "@tauri-apps/plugin-dialog";
import { writable } from 'svelte/store';
import { _ } from 'svelte-i18n';

import { Debug } from "./Debug";
import { SubtitleStyle, Subtitles } from "./core/Subtitles.svelte";
import { AlignMode } from "./core/Labels";
import { SubtitleTools } from "./core/SubtitleUtil.svelte";
import { Utils } from "./frontend/Utils";
import { ChangeType, Source } from "./frontend/Source";
import { WrapStyle } from "./details/TextLayout";

import { Collapsible, ConfigRow, ConfigTable, NumberInput } from "@the_dissidents/svelte-ui";
import FilterEdit from "./FilterEdit.svelte";
import FontSelect from "./FontSelect.svelte";
import Colorpicker from "./ui/Colorpicker.svelte";

import { openDialog } from "./DialogOutlet.svelte";
import { Dialog } from "./dialog";
  import { SavedStyles } from "./config/SavedStyles";
  import LintProfileSelect from "./LintProfileSelect.svelte";

interface Props {
  style: SubtitleStyle;
  subtitles: Subtitles;
  onsubmit?: () => void;
}

let { style: _style, subtitles = $bindable(), onsubmit }: Props = $props();
let alignSelector: HTMLSelectElement | undefined = $state();
let wrapSelector: HTMLSelectElement | undefined = $state();
let duplicateWarning = $state(false);

// todo: why?
let style = writable(_style);

function isDuplicate(name: string) {
  for (const s of subtitles.styles) {
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
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      async action() {
        if (isDefault) {
          await dialog.message($_('msg.you-cant-delete-a-default-style'));
          return;
        }

        if (used.length > 0 && !await dialog.confirm(
          $_('msg.proceed-delete-n-occurrences', { values: { n: used.length } })))
            return;

        used.forEach((ent) => ent.texts.size == 1
          ? subtitles.entries.splice(subtitles.entries.indexOf(ent), 1)
          : ent.texts.delete($style));

        let i = subtitles.styles.indexOf($style);
        if (i < 0) return Debug.early();
        subtitles.styles.splice(i, 1);
        await Source.markChanged(
          used.length > 0 ? ChangeType.General : ChangeType.StyleDefinitions, $_('c.delete-style'));
        onsubmit?.();
      }
    },
    {
      text: $_('style.duplicate'),
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      async action() {
        let clone = SubtitleStyle.clone($style);
        clone.name = SubtitleTools.getUniqueStyleName(subtitles, $style.name);
        subtitles.styles.push(clone);
        // subtitles.styles = subtitles.styles;
        await Source.markChanged(ChangeType.StyleDefinitions, $_('c.duplicate-style'));
        onsubmit?.();
      }
    },
    {
      text: $_('style.replace-by'),
      enabled: Source.subs.styles.length > 1 && used.length > 0,
      items: withoutThis.map((x) => ({
        text: x.name,
        action: () => Utils.replaceStyle(subtitles.entries, $style, x)
      }))
    },
    {
      text: $_('style.exchange-with'),
      enabled: Source.subs.styles.length > 1 && used.length > 0,
      items: withoutThis.map((x) => ({
        text: x.name,
        action: () => Utils.exchangeStyle(subtitles.entries, $style, x)
      }))
    },
    {
      item: 'Separator'
    },
    {
      text: $_('style.presets'),
      items: [
        {
          text: $_('style.replace-by'),
          items: $SavedStyles.length > 0
            ? $SavedStyles.map((x) => ({
                text: x.name,
                async action() {
                  Object.assign($style, x);
                  $style.name = SubtitleTools.getUniqueStyleName(Source.subs, x.name, $style);
                  $style = $style;
                  await Source.markChanged(ChangeType.StyleDefinitions, $_('action.replace-style-by-preset'));
                }
              }))
            : [{
                text: $_('msg.no-saved-styles'),
                enabled: false
              }]
        },
        {
          text: $_('style.save-as-preset'),
          // eslint-disable-next-line @typescript-eslint/no-misused-promises
          async action() {
            const i = $SavedStyles.findIndex((x) => x.name == $style.name);
            if (i >= 0) {
              if (!await dialog.ask($_('msg.overwrite-preset-with-same-name'))) return;
              $SavedStyles.splice(i, 1);
            }
            $SavedStyles.push(SubtitleStyle.clone($style));
            SavedStyles.markChanged();
          }
        }
      ]
    }
  ]});
  await menu.popup();
}

let update = $state(0);
const me = {};
Source.onSubtitlesChanged.bind(me, (t) => {
  if (t == ChangeType.General || t == ChangeType.Times)
    update++;
})
</script>

<Collapsible active={true}>

{#snippet header()}
  {#key update}
  {@const n = subtitles.entries.filter((x) => x.texts.has($style)).length}
    {$style.name} <span class="usage">{$_('style.usage-msg', {values: { n }})}</span>
  {/key}
{/snippet}

<div class='hlayout'>
  <!-- toolbar -->
  <div class="toolbar">
    <!-- add style -->
    <button
      onclick={async () => {
        const i = subtitles.styles.indexOf($style);
        Debug.assert(i >= 0);
        const name = SubtitleTools.getUniqueStyleName(subtitles, 'new');
        const newStyle = SubtitleStyle.new(name);
        subtitles.styles = subtitles.styles.toSpliced(i, 0, newStyle);
        await Source.markChanged(ChangeType.StyleDefinitions, $_('c.add-style'));
        onsubmit?.();
      }}
      aria-label='add'
    ><PlusIcon /></button><br/>
    <!-- move up -->
    <button disabled={$style === subtitles.styles[0]}
      onclick={async () => {
        const i = subtitles.styles.indexOf($style);
        Debug.assert(i >= 0);
        subtitles.styles = [
          ...subtitles.styles.slice(0, i-1),
          $style,
          subtitles.styles[i-1],
          ...subtitles.styles.slice(i+1)
        ];
        await Source.markChanged(ChangeType.StyleDefinitions, $_('c.reorder-styles'));
        onsubmit?.();
      }}
      aria-label='move up'
    ><ArrowUp /></button><br/>
    <!-- move down -->
    <button disabled={$style === subtitles.styles.at(-1)}
      onclick={async () => {
        let i = subtitles.styles.indexOf($style);
        Debug.assert(i >= 0);
        subtitles.styles = [
          ...subtitles.styles.slice(0, i),
          subtitles.styles[i+1],
          $style,
          ...subtitles.styles.slice(i+2)
        ];
        await Source.markChanged(ChangeType.StyleDefinitions, $_('c.reorder-styles'));
        onsubmit?.();
      }}
      aria-label='move down'
    ><ArrowDown /></button><br/>
    <button onclick={() => contextMenu()} aria-label='more'>
      <MoreHorizontalIcon />
    </button><br/>
  </div>
  <!-- properties -->
  <div class="flexgrow vlayout">
    <!-- basic -->
    <ConfigTable>
      <ConfigRow name={$_('style.name')}>
        <div class="hlayout">
          <input type='text'
            value={$style.name}
            class={{duplicate: duplicateWarning, flexgrow: true}}
            oninput={(ev) => duplicateWarning = isDuplicate(ev.currentTarget.value)}
            onchange={async (ev) => {
              if (isDuplicate(ev.currentTarget.value)) {
                ev.currentTarget.value = $style.name;
                duplicateWarning = false;
              } else {
                $style.name = ev.currentTarget.value;
                await Source.markChanged(ChangeType.InPlace, $_('c.style-name'));
              }
            }}/>
          <label style="padding-left: 5px;">
            <input type='checkbox'
              checked={subtitles.defaultStyle == $style}
              onclick={async (ev) => {
                subtitles.defaultStyle = $style;
                ev.currentTarget.checked = true;
                await Source.markChanged(ChangeType.InPlace, $_('c.default-style'));
              }}/>
            {$_('style.default')}
          </label>
        </div>
      </ConfigRow>
      <ConfigRow name={$_('style.font')}>
        <FontSelect bind:value={$style.font}
          style="width: 100%"
          onChange={() => Source.markChanged(ChangeType.InPlace, $_('c.style-font'))}/>
      </ConfigRow>
      <ConfigRow name={$_('style.size')}>
        <div class="hlayout style">
        <NumberInput width="100%" bind:value={$style.size}
          onchange={() => Source.markChanged(ChangeType.InPlace, $_('c.style-font-size'))}/>
        <label><input type='checkbox' bind:checked={$style.styles.bold}
          onchange={() => Source.markChanged(ChangeType.InPlace, $_('c.style-font-style'))}
          /><b>B</b></label>
        <label><input type='checkbox' bind:checked={$style.styles.italic}
          onchange={() => Source.markChanged(ChangeType.InPlace, $_('c.style-font-style'))}
          /><i>I</i></label>
        <label><input type='checkbox' bind:checked={$style.styles.underline}
          onchange={() => Source.markChanged(ChangeType.InPlace, $_('c.style-font-style'))}
          /><u>U</u></label>
        <label><input type='checkbox' bind:checked={$style.styles.strikethrough}
          onchange={() => Source.markChanged(ChangeType.InPlace, $_('c.style-font-style'))}
          /><s>S</s></label>
        </div>
      </ConfigRow>
      <ConfigRow name={$_('style.lint-profile')}>
      <div class="hlayout">
        <label>
          <input type='checkbox' class="button" checked={!!$style.lintProfile}
            onclick={(e) => {
              if (e.currentTarget.checked) {
                if (!$style.lintProfile)
                  $style.lintProfile = { bracketGroups: [], regexes: [], forbiddenPunctuation: '' };
              } else {
                $style.lintProfile = null;
              }
            }}>
          {$style.lintProfile ? $_('style.lint-enabled') : $_('style.lint-disabled')}
        </label>
        {#if $style.lintProfile}
          <LintProfileSelect value={$style.lintProfile}
            onChange={async (x) => {
              if (x) {
                $style.lintProfile = x;
                await Source.markChanged(ChangeType.LintProfile, $_('c.lint-profile'));
              }
            }} />
          <button type='button' onclick={async () => {
            const result = await openDialog(Dialog.lintProfile, $style.lintProfile!);
            if (result) {
              $style.lintProfile = result;
              await Source.markChanged(ChangeType.LintProfile, $_('c.lint-profile'));
            }
          }}>
            {$_('style.lint-edit')}
          </button>
        {/if}
      </div>
      </ConfigRow>
    </ConfigTable>
    <!-- validator -->
    <Collapsible header={$_('style.validator')}>
      <FilterEdit bind:filter={$style.validator}
        availableContexts={['entry', 'channel']}
        onchange={() => Source.markChanged(ChangeType.Filter, $_('c.style-filter'))} />
    </Collapsible>
    <!-- advanced -->
    <Collapsible header={$_('style.more-styling')}>
      <ConfigTable>
        <ConfigRow name={$_('style.text-color')}>
          <Colorpicker bind:color={$style.color}
            onchange={() => Source.markChanged(ChangeType.InPlace, $_('c.style-color'))}/>
        </ConfigRow>
        <ConfigRow name={$_('style.line-color')}>
          <Colorpicker bind:color={$style.outlineColor}
            onchange={() => Source.markChanged(ChangeType.InPlace, $_('c.style-line-color'))}/>
        </ConfigRow>
        <ConfigRow name={$_('style.line-size')}>
          <NumberInput width="100%" bind:value={$style.outline} min='0'
            onchange={() => Source.markChanged(ChangeType.InPlace, $_('c.style-line-size'))}/>
        </ConfigRow>
        <ConfigRow name={$_('style.shadow-color')}>
          <Colorpicker bind:color={$style.shadowColor}
            onchange={() => Source.markChanged(ChangeType.InPlace, $_('c.style-shadow-color'))}/>
        </ConfigRow>
        <ConfigRow name={$_('style.shadow')}>
          <NumberInput width="100%" bind:value={$style.shadow} min='0'
            onchange={() => Source.markChanged(ChangeType.InPlace, $_('c.style-shadow'))}/>
        </ConfigRow>
        <ConfigRow name={$_('style.alignment')}>
          <select
              bind:this={alignSelector}
              value={AlignMode[$style.alignment]}
              oninput={async () => {
                $style.alignment = alignSelector!.selectedIndex + 1;
                await Source.markChanged(ChangeType.InPlace, $_('c.style-alignment'));
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
        </ConfigRow>
        <ConfigRow name={$_('style.wrap-style')}>
          <select
              bind:this={wrapSelector}
              value={$style.wrapStyle}
              oninput={async () => {
                $style.wrapStyle = wrapSelector!.selectedIndex;
                await Source.markChanged(ChangeType.InPlace, $_('c.wrap-style'));
              }}>
            <option value={WrapStyle.Balanced}>{$_('style.wrap-balanced')}</option>
            <option value={WrapStyle.Greedy}>{$_('style.wrap-greedy')}</option>
            <option value={WrapStyle.NoWrap}>{$_('style.wrap-nowrap')}</option>
          </select>
        </ConfigRow>
        <ConfigRow name={$_('style.margins')}>
          <div class="flex margin">
            <div><label>{$_('style.top')}
              <NumberInput min={0} max={1000}
                bind:value={$style.margin.top}
                onchange={() => Source.markChanged(ChangeType.InPlace, $_('c.style-margin'))}/>
            </label></div>
            <div><label>{$_('style.bottom')}
              <NumberInput min={0} max={1000}
                bind:value={$style.margin.bottom}
                onchange={() => Source.markChanged(ChangeType.InPlace, $_('c.style-margin'))}/>
            </label></div>
            <div><label>{$_('style.left')}
              <NumberInput min={0} max={1000}
                bind:value={$style.margin.left}
                onchange={() => Source.markChanged(ChangeType.InPlace, $_('c.style-margin'))}/>
            </label></div>
            <div><label>{$_('style.right')}
              <NumberInput min={0} max={1000}
                bind:value={$style.margin.right}
                onchange={() => Source.markChanged(ChangeType.InPlace, $_('c.style-margin'))}/>
            </label></div>
          </div>
        </ConfigRow>
      </ConfigTable>
    </Collapsible>
  </div>
</div>

</Collapsible>

<style lang='scss'>
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

.style label {
  white-space: nowrap;
  padding-right: 5px;
  font-family: 'Times New Roman', Times, serif;
}

.usage {
  color: gray
}

input {
  width: 100%;
}

input[type='checkbox'] {
  width: auto;
  margin-right: 5px;
}
.margin label {
  /* width: 50px; */
  display: inline-block;
}
.margin div {
  padding-right: 15px;
}
</style>
