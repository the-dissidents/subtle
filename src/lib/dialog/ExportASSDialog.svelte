<script lang="ts">
import type { ResolvedFontFace } from '../bindings/ResolvedFontFace';
import type { SubsetResult } from '../bindings/SubsetResult';
import { type SubtitleStyle } from '../core/Subtitles.svelte';
import { ASSWriter } from '../core/formats/ASS.svelte';
import { ASSString } from '../core/formats/ASSString';
import { Source } from '../frontend/Source';
import { Interface } from '../frontend/Interface';

import { Fonts } from '../Fonts';
import { MAPI } from '../API';
import { Debug } from '../Debug';

import DialogBase from '../DialogBase.svelte';
import { Tooltip } from '@the_dissidents/svelte-ui';

import { CircleAlertIcon, CircleCheckIcon, CircleQuestionMarkIcon, CircleXIcon, InfoIcon, MessageSquareMoreIcon,  } from '@lucide/svelte';
import { onMount } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import { _ } from 'svelte-i18n';

interface Props {
  args: [],
  close: (ret: void) => void
}

let { args: _args, close }: Props = $props();
let inner: DialogBase;

onMount(async () => {
  let subs = Source.subs;
  let map = new Map<string, number>();
  const inlineFontNames = new Set<string>();
  for (const entry of subs.entries) {
    for (const [style, rt] of entry.texts) {
      map.set(style.name, (map.get(style.name) ?? 0) + 1);
      if (Array.isArray(rt)) {
        for (const part of rt) {
          if (typeof part === 'string') continue;
          const matched = ASSString.findMatchingInlineStyle(part.attrs, style, subs.styles);
          if (matched)
            map.set(matched.name, (map.get(matched.name) ?? 0) + 1);
          for (const attr of part.attrs) {
            if (typeof attr === 'object' && attr.type === 'font' && attr.value)
              inlineFontNames.add(attr.value);
          }
        }
      }
    }
  }
  styles = subs.styles.map(
    (x) => ({style: x, count: map.get(x.name) ?? 0, use: !x.hidden}));

  fonts.clear();
  const ensureFont = async (fontName: string, styleName?: string) => {
    if (fonts.has(fontName)) {
      if (styleName) fonts.get(fontName)!.styles.add(styleName);
    } else {
      const obj = $state({
        used: true,
        face: (await Fonts.getFamily(fontName))?.[0] ?? undefined,
        styles: new Set(styleName ? [styleName] : []),
        inlineOnly: !styleName,
        subset: {
          type: 'none'
        }
      } satisfies FontSetting);
      fonts.set(fontName, obj);
    }
  };
  for (const s of styles) if (s.style.font) {
    await ensureFont(s.style.font, s.style.name);
  }
  for (const fontName of inlineFontNames) {
    await ensureFont(fontName);
  }
  update();

  const btn = await inner!.showModal!();
  if (btn !== 'ok')
    return close();

  const writer = new ASSWriter(Source.subs);
  for (const [name, setting] of fonts)
    if (setting.used && setting.subset.type == 'ok')
      writer.embeddFontData(
        name, setting.subset.result.extension,
        setting.subset.result.encoded
      );

  await Interface.askExportFile('ass', () => writer.toString());
  close();
});

type FontSetting = {
  used: boolean,
  styles: Set<string>,
  inlineOnly?: boolean,
  face?: ResolvedFontFace,
  subset: SubsetState
};

type SubsetState = {
  type: 'none',
} | {
  type: 'working'
} | {
  type: 'ok',
  result: SubsetResult
} | {
  type: 'error',
  msg: string
};

let styles: {style: SubtitleStyle, count: number, use: boolean}[] = $state([]);
const fonts = new SvelteMap<string, FontSetting>();

function update() {
  for (const [_, s] of fonts)
    s.used = Boolean(s.inlineOnly);

  for (const s of styles)
    if (s.use && s.count > 0 && s.style.font) {
      const setting = fonts.get(s.style.font)!;
      setting.used = true;
    }
}

async function handleSubsetButton(fontName: string, setting: FontSetting) {
  if (!setting.face) return;

  switch (setting.subset.type) {
    case 'none': {
      setting.subset = { type: 'working' };
      let text = '';
      for (const entry of Source.subs.entries) {
        for (const [style, rt] of entry.texts) {
          if (typeof rt === 'string') {
            if (setting.styles.has(style.name)) text += rt;
          } else {
            for (const part of rt) {
              if (typeof part === 'string') {
                if (setting.styles.has(style.name)) text += part;
              } else {
                const fontAttr = part.attrs.find(
                  (a): a is { type: 'font', value: string } => typeof a === 'object' && a.type === 'font'
                );
                if (fontAttr) {
                  if (fontAttr.value === fontName) text += part.content;
                } else if (setting.styles.has(style.name)) {
                  text += part.content;
                }
              }
            }
          }
        }
      }

      try {
        const result = await MAPI.subsetEncode(setting.face.url, setting.face.index, text);
        setting.subset = { type: 'ok', result };
      } catch (e) {
        await Debug.forwardError(e);
        setting.subset = { type: 'error', msg: String(e) };
      }
      break;
    }
    case 'ok':
    case 'error':
      setting.subset = { type: 'none' };
      break;
    case 'working':
      break;
  }
}

</script>

<DialogBase bind:this={inner} maxWidth="50em">
  {#snippet header()}
    <h4>{$_('exportassdialog.header')}</h4>
  {/snippet}
  <div class="hlayout">
    <div class="leftpane">
      <table class="data">
        <thead>
        <tr>
          <th></th>
          <th class="stylename">{$_('exportdialog.style')}</th>
          <th></th>
          <th>{$_('exportdialog.usage')}</th>
        </tr>
        </thead>
        <tbody>
        {#each styles as entry (entry)}
        <tr>
          <td><input type="checkbox"
            bind:checked={() => entry.use && entry.count > 0, (x) => entry.use = x}
            disabled={entry.count == 0}
            onchange={() => update()}/></td>
          <td>{entry.style.name}</td>
          <td>{entry.style.hidden ? $_('exportdialog.hidden') : ''}</td>
          <td>{entry.count}</td>
        </tr>
        {/each}
        </tbody>
      </table>

      <p style="font-size: 90%; margin: 5px;">
        {$_('exportassdialog.format-d')}
      </p>
    </div>

    <div class='vlayout rightpane'>
      <h5>{$_('exportassdialog.fonts')}</h5>
      <ul class="ass-export-fonts">
        {#if styles.find((x) => x.use && !x.style.font)}
        <li>
          {$_('exportassdialog.unspecified')}
          <ul>
            <li class="warn">
              <CircleAlertIcon />
              {$_('exportassdialog.unspecified-list')}{
                styles
                  .filter((x) => x.use && !x.style.font)
                  .map((x) => x.style.name).join('  ')
              }
            </li>
          </ul>
        </li>
        <hr/>
        <li class="info-group">
          {$_('exportassdialog.unspecified-d')}
        </li>
        <br>
        {/if}

        {#if [...fonts].find((x) => x[1].used)}
        {#each [...fonts].filter((x) => x[1].used) as [name, setting]}
        {@const w = Fonts.windowsAvailability(name)}
        {@const m = Fonts.macosAvailability(name)}
        <li>
          <div class='fontname'>
            <span class='flexgrow'>{name}</span>
            <span><label>
              <input type='checkbox' class="button"
                disabled={!setting.face || setting.subset.type == 'working'}
                checked={setting.subset.type == 'ok'}
                onchange={() => handleSubsetButton(name, setting)}/>

              {setting.face
                ? (setting.subset.type == 'ok' ? $_('exportassdialog.remove-embedding')
                 : setting.subset.type == 'working' ? $_('exportassdialog.working')
                 : setting.subset.type == 'error' ? $_('exportassdialog.error')
                 : ((!w.status || !m.status)
                      ? $_('exportassdialog.embedd-this-font-recommended')
                  : (w.status && m.status && !w.supplement && !m.supplement)
                      ? $_('exportassdialog.embedd-this-font-not-recommended')
                      : $_('exportassdialog.embedd-this-font')))
                : $_('exportassdialog.cannot-embedd')}
            </label></span>
          </div>
          <ul>
            {#if setting.subset.type == 'ok'}
            {@const result = setting.subset.result}
              <li class="ok">
                <CircleCheckIcon />
                {$_('exportassdialog.embedded')}
              </li>
              <li class="ok">
                <InfoIcon />
                {$_('exportassdialog.embed-info', { values:
                  { a: result.nGlyphs, b: result.encoded.length } })}
              </li>
              {#if result.missing.length > 0}
                <li class="warn">
                  <CircleQuestionMarkIcon />
                  {$_('exportassdialog.glyphs-not-found', {values: { n: result.missing.length }})}
                  <Tooltip text={result.missing.length > 100
                    ? result.missing.slice(0, 100) + ' [...]'
                    : result.missing
                  }>
                    <span>
                      <MessageSquareMoreIcon />
                    </span>
                  </Tooltip>
                </li>
              {/if}
            {:else}
              {#if !setting.face}
                <li class="error">
                  <CircleXIcon />
                  {$_('exportassdialog.font-not-found')}
                </li>
              {/if}
              {#if w.status}
                {#if w.supplement}
                  <li class="warn">
                    <CircleQuestionMarkIcon />
                    {$_('exportassdialog.available-on-windows-through-supplement', {values: {s: w.supplement}})}
                  </li>
                {:else}
                  <li class="ok">
                    <CircleCheckIcon />
                    {$_('exportassdialog.built-in-on-windows')}
                  </li>
                {/if}
              {:else}
                <li class="warn">
                  <CircleAlertIcon />
                  {$_('exportassdialog.not-directly-available-on-windows')}
                </li>
              {/if}

              {#if m.status}
                {#if m.supplement}
                  <li class="warn">
                    <CircleQuestionMarkIcon />
                    {$_('exportassdialog.downloadable-on-macos-but-not-necessarily-built-in')}
                  </li>
                {:else}
                  <li class="ok">
                    <CircleCheckIcon />
                    {$_('exportassdialog.built-in-on-macos')}
                  </li>
                {/if}
              {:else}
                <li class="warn">
                  <CircleAlertIcon />
                  {$_('exportassdialog.not-directly-available-on-macos')}
                </li>
              {/if}
            {/if}
          </ul>
        </li>
        {/each}
        <hr/>
        <li class="info-group">
          {$_('exportassdialog.font-d')}
        </li>
        {/if}
      </ul>
    </div>
  </div>
</DialogBase>

<style lang='scss'>
  .stylename {
    min-width: 100px;
  }
  table {
    margin-right: 5px;
    width: 100%;
  }
  .leftpane {
    margin-left: 10px;
    flex: 1 0;
  }
  .rightpane {
    margin-left: 10px;
    flex: 1.5 0;
  }

  div.fontname {
    display: flex;
  }

  ul.ass-export-fonts {
    margin: 0;
    list-style: none;
    padding: 0px;

    & > li {
      margin: 5px 0px;
      font-weight: bold;

      &.info-group {
        font-weight: normal;
        padding: 0 0.2em 0 0.2em;
        font-size: 90%;
        color: gray;
        line-height: 1.5;
        text-align: justify;
      }
    }

    ul {
      padding: 3px 0 0 0;
      list-style-type: none;
      font-weight: normal;
      & > li {
        padding: 2px 0 0 0;
        font-size: 95%;
      }
    }

    :global(.lucide) {
      display: inline;
      color: var(--uchu-orange-6);
      vertical-align: text-bottom;
      max-height: 1.2em;
      stroke-width: 1.5px;
    }
    :global(.error .lucide) {
      color: red;
    }
    :global(.ok .lucide) {
      color: green;
    }
  }
</style>
