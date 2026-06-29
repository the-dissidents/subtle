<script lang="ts">
import * as dialog from "@tauri-apps/plugin-dialog";
import * as fs from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { Menu } from '@tauri-apps/api/menu';

import { MAPI } from "../API";
import { Debug } from '../Debug';

import { UICommand } from '../frontend/CommandBase';
import { Source, SourceCommands } from '../frontend/Source';
import { DialogCommands } from "../frontend/Dialogs";
import { Typography } from '../details/Typography';
import { CharacterTokenizer, DefaultTokenizer, Searcher, SyllableTokenizer, type Tokenizer } from "../details/Fuzzy";

import { Tooltip, type TooltipPosition } from "@the_dissidents/svelte-ui";
import { Fonts } from "../Fonts";
import { Dialog } from "../dialog";
import { openDialog } from "../DialogOutlet.svelte";

import { BracketSetPresets } from "../linter/brackets/Presets";
import { BracketLinter, type BracketSet } from "../linter/brackets/Brackets";
import { Diagnostic } from "../linter/Common";
  import { showInputPopup } from "../ui/InputPopup.svelte";
  import { showConfirmationPopup } from "../ui/ConfirmationPopup.svelte";

let result = $state("");
Fonts.onInit(async () => {
  const version = await MAPI.version();
  const arial = (await Fonts.getFamily('Arial'))!;
  result = `ffmpeg version is ${version}; UA is ${navigator.userAgent}; factor for Arial: ${Typography.getRealDimFactor('Arial')}; fonts got ${arial.map((x) => `${x.fullName}=${x.realHeight}`)}`;
});

let hwaccel = $state(false);
let tooltipPos: TooltipPosition = $state('bottom');

let textarea = $state<HTMLTextAreaElement>();
let haystack = $state('');
let needle = $state('');

let fontname = $state('Arial');

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

function testFuzzy(tok: Tokenizer<string, string>) {
  const [tks, _] = tok.tokenize(needle);
  let text = tks.join('|') + '\n';

  const engine = new Searcher(haystack, tok);
  const res = engine.search(needle);
  if (res) {
    text += `${res.merged.map((x) =>
        x.type == 'match' ? x.first.join('')
      : x.type == 'delete' ? '[' + x.first.join('') + ']'
      : x.type == 'insert' ? '<' + x.second.join('') + '>'
      : x.type == 'subtitute' ? '{' + x.first.join('') + '|' + x.second.join('') + '}'
      : Debug.never(x.type)
    ).join('')} (${res.matchRatio.toFixed(3)})`;
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

let bracketPreset: keyof typeof BracketSetPresets = $state('curlyQuotes');
let bracketResult = $state('');
let forbidDeepNesting = $state(true);
</script>


<button onclick={async (e) => {
  const input = await showConfirmationPopup(e.currentTarget, 'xyzzy?');
  result = `confirmation popup: ${input}`;
}}>confirm</button>

<button onclick={async (e) => {
  const input = await showInputPopup(e.currentTarget, 'enter:', {
    validate: (s) => s.length > 5,
    position: 'right'
  });
  result = `input popup: ${input}`;
}}>input</button>

<button onclick={async () => {
  openDialog(Dialog.lintProfile, {
    bracketGroups: ['curlyQuotes', 'halfwidthParentheses'], regexes: [],
    forbiddenPunctuation: ''
  });
}}>test lint profile dialog</button>

<button onclick={async () => {
  await dialog.save({
    filters: [{name: 'HTML', extensions: ['html']}],
  });
}}>test save dialog</button>

<button onclick={async () => {
  DialogCommands.compareDialog.call();
}}>compare</button>

<button
  onclick={async () => {
    Debug.info(await MAPI.config());
  }}>
  ffmpeg config
</button>

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
  onclick={() => openDialog(Dialog.keybindingInput, SourceCommands.undo, null)}>
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

<textarea bind:this={textarea} bind:value={haystack} style:width="100%"></textarea>

<h5>brackets</h5>
<select bind:value={bracketPreset}>
  {#each Object.keys(BracketSetPresets) as key}
    <option value={key}>{key}</option>
  {/each}
</select>
<button onclick={() => {
  const preset: BracketSet = {
    ...BracketSetPresets[bracketPreset],
    deepNestingPolicy: forbidDeepNesting ? 'forbid' : 'cycle'
  };
  const linter = new BracketLinter([preset]);
  bracketResult = linter.check(haystack)
    .map((x) => Diagnostic.prettyPrint(x, haystack)).join('\n\n');
  if (bracketResult == '')
    bracketResult = 'no problems';
}}>check</button>
<label>
  <input type='checkbox' bind:checked={forbidDeepNesting}>
  forbid deeply nested brackets
</label>

<br>
<pre style="overflow-x: scroll; white-space: pre; width: 100%; padding: 0; margin: 0">
<code>{bracketResult}</code>
</pre>

<h5>fuzzy</h5>
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
