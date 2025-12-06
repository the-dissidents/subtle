<!-- TODO: KeybindingInputDialog
  1. Support chords
-->

<script lang="ts">
import { Debug } from '../Debug';
import DialogBase from '../DialogBase.svelte';
import { _ } from 'svelte-i18n';
import { CommandBinding, KeyBinding, KeybindingManager } from '../frontend/Keybinding';
import { UIFocusList, type UIFocus } from '../frontend/Frontend';
import type { UICommand } from '../frontend/CommandBase';

import { onMount } from 'svelte';

interface Props {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: [cmd: UICommand<any>, bindings: CommandBinding | null],
  close: (ret: CommandBinding | null) => void
}

let {
  args, close
}: Props = $props();

let [command, bindings] = args;
let inner: DialogBase;

onMount(async () => {
  Debug.assert(inner !== undefined);
  key = bindings?.sequence[0] ?? null;
  if (bindings?.contexts == undefined) {
    anyContext = true;
    contexts = new Set<UIFocus>;
  } else {
    anyContext = false;
    contexts = new Set(bindings.contexts);
  }
  check();
  let result = await inner.showModal!();
  if (result == 'ok' && key !== null)
    return close(cmdBinding());
  close(null);
});

let key = $state<KeyBinding | null>(null);
let anyContext = $state(false);
let contexts = $state(new Set<UIFocus>());
let error = $state('');

function cmdBinding(): CommandBinding {
  Debug.assert(key !== null);
  return new CommandBinding([key], anyContext ? undefined : contexts);
}

function check() {
  if (key === null) {
    error = '';
    return;
  }
  const conflicts = KeybindingManager.findConflict(cmdBinding(), command);
  if (conflicts.length == 0)
    error = '';
  else {
    error = $_('keyinput.conflicts', 
      {values: {list: conflicts.map(
        ([cmd, list]) => `${cmd.name} – ${
          list.length == 0 
            ? $_('keyinput.any')
            : list.map((x) => $_(`context.${x}`)).join(' | ')
        }`).join('\n')}});
  }
}
</script>

<DialogBase bind:this={inner} maxWidth="60em" buttons={[{
  name: 'cancel',
  localizedName: () => $_('cancel')
}, {
  name: 'ok',
  disabled: () => (key == null || error !== ''),
  localizedName: () => $_('ok')
}]}>
  {#snippet header()}
    <h3>{$_('keyinput.input-keybinding-for-what', {values: {what: command?.name ?? ''}})}</h3>
  {/snippet}
  <div class='vlayout'>
    <input type='text'
      class={{keybinding: true, flexgrow: true, error}}
      placeholder={$_('keyinput.press-a-key')} 
      value={key?.toString() ?? ''}
      onkeydown={(ev) => {
        ev.preventDefault();
        const parsed = KeybindingManager.parseKey(ev);
        if (!parsed) return;
        key = parsed;
        check();
      }} />
    <hr>
    <button onclick={() => {
      key = null;
      check();
    }}>
      {$_('keyinput.clear')}
    </button>
    <!-- <label>
      <input type="checkbox" />
      {$_('keyinput.use-chord')}
    </label> -->
    <h5>{$_('keyinput.contexts')}</h5>
    <div>
      <label>
        <input type="checkbox"
          bind:checked={anyContext}
          onclick={check} />
        {$_('keyinput.any')}
      </label>
      {#each UIFocusList as x (x)}
        <label>
          <input type="checkbox"
            disabled={anyContext}
            checked={anyContext || contexts.has(x)}
            onchange={(ev) => {
              if (ev.currentTarget.checked)
                contexts.add(x);
              else
                contexts.delete(x);
              check();
            }} />
          {$_(`context.${x}`)}
        </label>
      {/each}
    </div>
    <hr>
    <span class="errortext">{error}</span>
  </div>
</DialogBase>

<style>
@media (prefers-color-scheme: light) {
  .error {
    background-color: lightcoral;
  }
  .errortext {
    color: brown;
  }
}
@media (prefers-color-scheme: dark) {
  .error {
    background-color: var(--uchu-red-9);
  }
  .errortext {
    color: var(--uchu-red-4);
  }
}

.keybinding {
  font-size: 1rem;
  padding: 5px;
}

.errortext {
  white-space: pre-wrap;
}
</style>