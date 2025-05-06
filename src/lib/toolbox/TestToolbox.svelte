<script lang="ts">
import chardet from 'chardet';
import * as dialog from "@tauri-apps/plugin-dialog";
import * as fs from "@tauri-apps/plugin-fs";

import { MAPI, MMedia, type AudioFrameData, type VideoFrameData } from "../API";
import { Debug } from '../Debug';
import { Menu } from '@tauri-apps/api/menu';
import { UICommand } from '../frontend/CommandBase';
import { Dialogs } from '../frontend/Dialogs';
import { Commands } from '../frontend/Commands';
import Tooltip, { type TooltipPosition } from '../ui/Tooltip.svelte';
import { Source } from '../frontend/Source';
import OrderableList from '../ui/OrderableList.svelte';
    import { Typography } from '../details/Typography';

let result = $state("");
MAPI.version().then((x) => {
  result = `ffmpeg version is ${x}; UA is ${navigator.userAgent}; factor for Arial: ${Typography.getRealDimFactor('Arial')}`;
});

let media: MMedia | undefined;
let tooltipPos: TooltipPosition = $state('bottom');

let list = $state([
  {text: '123'}, 
  {text: 'abc'}, 
  {text: '543t635'}, 
  {text: 'aeewwwbc'}, 
  {text: 'abdfcc'}
]);

const command = new UICommand([], {
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

</script>

<button
  onclick={async () => {
    let path = await dialog.open();
    if (!path) return;
    media = await MMedia.open(path);
    console.log('media opened');
    await media.openVideo(-1);
    console.log('video opened');
    await media.openAudio(-1);
    console.log('audio opened');
    result = media.streams.join(';');
  }}>
  open media
</button>

<button
  onclick={async () => {
    if (!media) return;
    let f = await media.readNextFrame();
    if (!f) result = "EOF!";
    else result = `${f.type} @${f.position}, time=${f.time}, length ${f.content.length}`
  }}>
  read frame
</button>

<button
  onclick={async () => {
    if (!media) return;
    let frames: (VideoFrameData | AudioFrameData | null)[] | null = [];
    for (let i = 0; i < 10; i++) {
      frames.push(await media.readNextFrame());
      await Debug.debug('+ frame', i);
      if (frames.length > 2)
        frames.shift();
    }
    await Debug.debug('deleting');
    frames = null;
  }}>
  test memory leak
</button>

<button
  onclick={async () => {
    let path = await dialog.open();
    if (!path) return;
    let file = await fs.readFile(path);
    let detected = chardet.analyse(file);
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
  onclick={async () => {
    throw new Error('test rejection');
  }}>
  create rejection
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
  onclick={() => Dialogs.keybindingInput!.showModal!([Commands.undo, null])}>
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
<span>{result}</span>
