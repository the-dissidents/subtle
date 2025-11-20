<script lang="ts">
import * as dialog from "@tauri-apps/plugin-dialog";
import * as fs from "@tauri-apps/plugin-fs";

import { MAPI } from "../API";
import { Debug } from '../Debug';
import { Menu } from '@tauri-apps/api/menu';

import { UICommand } from '../frontend/CommandBase';
import { Dialogs } from '../frontend/Dialogs';
import { Source, SourceCommands } from '../frontend/Source';

import Tooltip, { type TooltipPosition } from '../ui/Tooltip.svelte';
import OrderableList from '../ui/OrderableList.svelte';
import { Typography } from '../details/Typography';
import { CharacterTokenizer, DefaultTokenizer, Searcher, SyllableTokenizer, type Tokenizer } from "../details/Fuzzy2";
import { invoke } from "@tauri-apps/api/core";
  import FontSelect from "../FontSelect.svelte";
  import { Fonts } from "../Fonts";

let result = $state("");
MAPI.version().then((x) => {
  Fonts.onInit(async () => {
    const arial = (await Fonts.getFamily('Arial'))!;
    result = `ffmpeg version is ${x}; UA is ${navigator.userAgent}; factor for Arial: ${Typography.getRealDimFactor('Arial')}; fonts got ${arial.map((x) => `${x.fullName}=${x.realHeight}`)}`;
  });
});

let hwaccel = $state(false);
let tooltipPos: TooltipPosition = $state('bottom');

let textarea = $state<HTMLTextAreaElement>();
let haystack = $state('');
let needle = $state('');

let fontname = $state('Arial');

let list = $state([
  {text: '123'}, 
  {text: 'abc'}, 
  {text: '543t635'}, 
  {text: 'aeewwwbc'}, 
  {text: 'abdfcc'}
]);

const command = new UICommand(() => '', [], {
  name: 'name', 
  menuName: 'primary',
  items: ['one', 'two', 'three', 'four'].map((x) => ({
    name: x,
    menuName: 'secondary',
    items: ['five', 'six', 'seven', 'eight'].map((y) => ({
      name: y,
      call() {
        dialog.message(`${x}-${y}`);
      }
    }))
  }))
});

function testFuzzy(tok: Tokenizer) {
  const [tks, _] = tok.tokenize(needle);
  let text = tks.join('|') + '\n';

  const engine = new Searcher(haystack, tok);
  const res = engine.search(needle);
  if (res) {
    text += `${res.visualization} (${res.matchRatio.toFixed(3)})`;
    textarea!.focus();
    textarea!.setSelectionRange(res.start, res.end);
    Debug.info(res);
  } else {
    text += 'no match';
  }
  result = text;
}

function testAssertion() {
  Debug.assert(false);
}
</script>

<button
  onclick={async () => {
    Debug.info(await MAPI.config());
  }}>
  ffmpeg config
</button>

<FontSelect></FontSelect>

<label>
  <input type='checkbox' bind:checked={hwaccel} />
  hwaccel
</label>

<button
  onclick={async () => {
    let path = await dialog.open();
    if (!path) return;
    await MAPI.testPerformance(path, false, hwaccel);
  }}>
  test performance
</button>

<button
  onclick={async () => {
    let path = await dialog.open();
    if (!path) return;
    await MAPI.testPerformance(path, true, hwaccel);
  }}>
  test performance (w/ postprocessing)
</button>

<button
  onclick={async () => {
    let path = await dialog.open();
    if (!path) return;
    let file = await fs.readFile(path);
    let detected = (await import('chardet')).analyse(file);
    result = detected.map((x) => `${x.name} -- ${x.confidence}`).join('\n');
  }}>
  detect encoding
</button>

<button
  onclick={() => {
    throw new Error('test error');
  }}>
  create error
</button>

<button
  onclick={() => {
    Debug.assert(false);
  }}>
  create assertion failure 1
</button>

<button
  onclick={() => {
    testAssertion();
  }}>
  create assertion failure 2
</button>

<button
  onclick={async () => {
    throw new Error('test rejection');
  }}>
  create rejection
</button>

<button
  onclick={async () => {
    invoke('make_panic');
  }}>
  create panic
</button>

<button
  onclick={async () => {
    let m = Menu.new({
      items: [command.toMenuItem()]
    });
    (await m).popup();
  }}>
  menu command
</button>

<button
  onclick={() => command.call()}>
  direct command
</button>

<button
  onclick={() => Dialogs.keybindingInput!.showModal!([SourceCommands.undo, null])}>
  keybinding input
</button>

<Tooltip position={tooltipPos} text="content of tooltip">
  <button>tooltip</button>
</Tooltip>

<select bind:value={tooltipPos}>
  <option value="top">top</option>
  <option value="left">left</option>
  <option value="right">right</option>
  <option value="bottom">bottom</option>
</select>

<button
  onclick={() => Debug.info('integrity test:', Source.subs.debugTestIntegrity())}>
  integrity test
</button>

<br>

<OrderableList bind:list={list}>
  {#snippet row(item)}
    <input type="text" bind:value={item.text} />
  {/snippet}
</OrderableList>

<br>

<textarea bind:this={textarea} bind:value={haystack} style:width="100%"></textarea>
<input type="text" bind:value={needle}/>
<button onclick={() => testFuzzy(CharacterTokenizer)}>chartok</button>
<button onclick={() => testFuzzy(DefaultTokenizer)}>deftok</button>
<button onclick={() => testFuzzy(SyllableTokenizer)}>syltok</button>

<br>

<input type='text' bind:value={fontname} />
<button onclick={async () => {
  Debug.info(await MAPI.resolveFontFamily(fontname));
}}>resolve font family</button>

<br>

<span style="white-space: pre-wrap;">{result}</span>
