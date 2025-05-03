<!-- TODO: KeybindingInputDialog
  1. Support chords
-->

<script lang="ts">
import { Debug } from '../Debug';
import DialogBase from '../DialogBase.svelte';
import type { DialogHandler } from '../frontend/Dialogs';
import { _ } from 'svelte-i18n';
import { bindingToString, KeybindingManager, type CommandBinding, type KeyBinding } from '../frontend/Keybinding';
import type { UIFocus } from '../frontend/Frontend';
import type { UICommand } from '../frontend/CommandBase';

interface Props {
  handler: DialogHandler<[UICommand, CommandBinding | null], CommandBinding | null>;
}

let {
  handler = $bindable(),
}: Props = $props();

handler.showModal = async ([cmd, bind]) => {
  Debug.assert(inner !== undefined);
  command = cmd;
  binding = bind?.sequence[0] ?? null;
  if (bind?.contexts == undefined) {
    anyContext = true;
    contexts = new Set<UIFocus>;
  } else {
    anyContext = false;
    contexts = new Set(bind.contexts);
  }
  check();
  let result = await inner.showModal!();
  if (result == 'ok' && binding !== null) {
    return {
      sequence: [binding],
      contexts: undefined
    }
  }
  return null;
};

let inner: DialogHandler<void> = {};
let command = $state<UICommand>();
let binding = $state<KeyBinding | null>(null);
let anyContext = $state(false);
let contexts = $state(new Set<UIFocus>());
let error = $state('');

function cmdBinding(): CommandBinding {
  Debug.assert(binding !== null);
  return {
    sequence: [binding],
    contexts: anyContext ? undefined : contexts
  };
}

function check() {
  if (binding === null) {
    error = '';
    return;
  }
  const conflicts = KeybindingManager.findConflict(cmdBinding(), command!);
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

<DialogBase handler={inner} maxWidth="60em" buttons={[{
  name: 'cancel',
  localizedName: () => $_('cancel')
}, {
  name: 'ok',
  disabled: () => (binding == null || error !== ''),
  localizedName: () => $_('ok')
}]}>
  {#snippet header()}
    <h3>{$_('keyinput.input-keybinding-for-what', {values: {what: command?.name ?? ''}})}</h3>
  {/snippet}
  <div class='vlayout'>
    <input type='text'
      class={{keybinding: true, flexgrow: true, error}}
      placeholder={$_('keyinput.press-a-key')} 
      value={binding ? bindingToString(binding) : ''}
      onkeydown={(ev) => {
        ev.preventDefault();
        const key = KeybindingManager.parseKey(ev);
        if (!key) return;
        binding = key;
        check();
      }} />
    <hr>
    <button onclick={() => {
      binding = null;
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
      {#each (['EditingField', 'Table', 'Timeline', 'Other'] as const) as x}
        <label>
          <input type="checkbox"
            disabled={anyContext}
            checked={anyContext || contexts.has(x)}
            onclick={() => {
              contexts.add(x);
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