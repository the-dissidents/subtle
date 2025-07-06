<script lang="ts">
import DialogBase from '../DialogBase.svelte';
import { Debug } from '../Debug';
import { DialogHandler } from '../frontend/Dialogs';

import { _ } from 'svelte-i18n';
    import { openPath, openUrl } from '@tauri-apps/plugin-opener';
    import { appLogDir } from '@tauri-apps/api/path';

interface Props {
  handler: DialogHandler<void, void>;
}
    
let {
  handler = $bindable(),
}: Props = $props();

let inner = new DialogHandler<void>();
handler.showModal = async () => {
  Debug.assert(inner !== undefined);
  await inner.showModal!();
  return;
};
</script>

<DialogBase handler={inner} buttons={[{
  name: 'close',
  localizedName: () => $_('ok')
}]}>
  {#snippet header()}
    <h3>{$_('bugdialog.header')}</h3>
  {/snippet}

  <p>如果遇到行为异常或故障，请联系微信或豆瓣<code>emfrosztovis</code>。我们有一个用来交流问题和发布测试版本的微信群。如有可能请提供运行日志（其中可能包含一些个人信息，如打开的文档和视频的完整地址，但它不包含任何文档的内容）：</p>
  <button onclick={async () => openPath(await appLogDir())}>打开运行日志文件夹</button>
  <p>如果比较熟悉开发，也可以前往GitHub Issues页面直接提交问题说明。为了减轻开发人员压力，请在提交issue之前尽量确认之前没有人已经报告过同样的问题。</p>
  <button onclick={async () => openUrl('https://github.com/the-dissidents/subtle/issues')}>查看目前待处理的issues</button>
  <button onclick={async () => openUrl('https://github.com/the-dissidents/subtle/issues/new?template=%E9%97%AE%E9%A2%98%E6%8A%A5%E5%91%8A---bug-report.md')}>新增GitHub issue</button>
  <p></p>
</DialogBase>

<style>
  @media (prefers-color-scheme: light) {
    code {
      background-color: var(--uchu-blue-2);
    }
  }

  @media (prefers-color-scheme: dark) {
    code {
      background-color: var(--uchu-blue-8);
    }
  }

  code {
    margin-left: 2px;
    margin-right: 2px;
    border-radius: 0.5lh;
    padding: 1px 4px;
    user-select: text;
    -webkit-user-select: text;
    cursor: text;
  }
</style>