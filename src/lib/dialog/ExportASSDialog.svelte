<script lang="ts">
import type { ResolvedFontFace } from '../bindings/ResolvedFontFace';
import type { SubsetResult } from '../bindings/SubsetResult';
import { type SubtitleStyle } from '../core/Subtitles.svelte';
import { ASSWriter } from '../core/ASS.svelte';
import { Source } from '../frontend/Source';
import { Interface } from '../frontend/Interface';
import Tooltip from '../ui/Tooltip.svelte';
import DialogBase from '../DialogBase.svelte';
import { Fonts } from '../Fonts';
import { MAPI } from '../API';
import { Debug } from '../Debug';

import { CircleAlertIcon, CircleCheckIcon, CircleHelpIcon, CircleXIcon, InfoIcon, MessageSquareMoreIcon,  } from '@lucide/svelte';
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
  for (const entry of subs.entries)
    for (const [style, _] of entry.texts)
      map.set(style.name, (map.get(style.name) ?? 0) + 1);
  styles = subs.styles.map(
    (x) => ({style: x, count: map.get(x.name) ?? 0, use: true}));
  
  fonts.clear();
  for (const s of styles)
    if (s.style.font) {
      if (fonts.has(s.style.font)) {
        fonts.get(s.style.font)!.styles.add(s.style.name);
      } else {
        const obj = $state({
          used: true,
          face: (await Fonts.getFamily(s.style.font))?.[0] ?? undefined,
          styles: new Set([s.style.name]),
          subset: {
            type: 'none'
          }
        } satisfies FontSetting);
        fonts.set(s.style.font, obj);
      }
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
    s.used = false;

  for (const s of styles)
    if (s.use && s.style.font) {
      const setting = fonts.get(s.style.font)!;
      setting.used = true;
    }
}

async function handleSubsetButton(setting: FontSetting) {
  if (!setting.face) return;

  switch (setting.subset.type) {
    case 'none': {
      setting.subset = { type: 'working' };
      let text = '';
      for (const entry of Source.subs.entries)
        for (const channel of entry.texts)
          if (setting.styles.has(channel[0].name))
            text += channel[1];
      
      try {
        const result = await MAPI.subsetEncode(setting.face.url, setting.face.index, text);
        setting.subset = { type: 'ok', result };
      } catch (e) {
        Debug.forwardError(e);
        setting.subset = { type: 'error', msg: `${e}` };
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
          <th>{$_('exportdialog.usage')}</th>
        </tr>
        </thead>
        <tbody>
        {#each styles as entry (entry)}
        <tr>
          <td><input type="checkbox" 
            disabled={entry.count == 0}
            bind:checked={entry.use}
            onchange={() => update()}/></td>
          <td>{entry.style.name}</td>
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
      {#each fonts as [name, setting]}
      {#if setting.used}
      {@const w = Fonts.windowsAvailability(name)}
      {@const m = Fonts.macosAvailability(name)}
        <li>
          <div class='fontname'>
            <span class='flexgrow'>{name}</span>
            <span><label>
              <input type='checkbox' class="button"
                disabled={!setting.face}
                checked={setting.subset.type == 'ok'}
                onchange={() => handleSubsetButton(setting)}/>

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
                  <CircleHelpIcon />
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
                    <CircleHelpIcon />
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
                    <CircleHelpIcon />
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
      {/if}
      {/each}

        <hr/>
        <li class="info-group">
          {$_('exportassdialog.font-d')}
        </li>
      </ul>
    </div>
  </div>
</DialogBase>

<style>
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
    }
  }

  ul.ass-export-fonts ul {
    padding: 3px 0 0 3em;
    list-style-type: none;
    font-weight: normal;
    & > li {
      padding: 2px 0 0 0;
      font-size: 95%;
    }
  }

  li.info-group {
    font-weight: normal;
    padding: 0 0.2em 0 0.2em;
    font-size: 90%;
    color: gray;
    line-height: 1.5;
    text-align: justify;
  }

  :global(.ass-export-fonts .lucide) {
    display: inline;
    color: var(--uchu-orange-6);
    vertical-align: text-bottom;
    max-height: 1.2em;
    stroke-width: 1.5px;
  }

  :global(.ass-export-fonts .error .lucide) {
    color: red;
  }

  :global(.ass-export-fonts .ok .lucide) {
    color: green;
  }
</style>