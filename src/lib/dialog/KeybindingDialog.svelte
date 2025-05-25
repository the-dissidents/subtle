<script lang="ts">
import { Debug } from '../Debug';
import DialogBase from '../DialogBase.svelte';
import { Commands } from '../frontend/Commands';
import { Dialogs, type DialogHandler } from '../frontend/Dialogs';
import { _, locale } from 'svelte-i18n';
import { KeybindingManager, type CommandBinding } from '../frontend/Keybinding';
import type { UICommand } from '../frontend/CommandBase';
import { CreditCardIcon, MenuIcon, PlusIcon, RefreshCwIcon, Trash2Icon } from '@lucide/svelte';

interface Props {
  handler: DialogHandler<void, void>;
}

let {
  handler = $bindable()
}: Props = $props();

handler.showModal = async () => {
  Debug.assert(inner !== undefined);
  await inner.showModal!();
  await KeybindingManager.save();
};

let inner: DialogHandler<void> = {};
// let filter = $state('');
let refresh = $state(false);

function groupedCommands() {
  const result = new Map<string, UICommand<any>[]>();
  Object.entries(Commands).forEach(([_, cmd]) => {
    const category = cmd.category();
    if (!result.has(category))
      result.set(category, []);
    result.get(category)!.push(cmd);
  });
  return result;
}

function isDefault(cmd: UICommand<any>) {
  const a = JSON.stringify(cmd.bindings.map((x) => x.toSerializable()));
  const b = JSON.stringify(cmd.defaultBindings.map((x) => x.toSerializable()));
  return a == b;
}

locale.subscribe(() => refresh = !refresh);
</script>

<DialogBase handler={inner} maxWidth="60em" buttons={[{
  name: 'ok',
  localizedName: () => $_('ok')
}]}>
  {#snippet header()}
    <h3>{$_('menu.keybinding')}</h3>
  {/snippet}

  <div class="vlayout">
    <!-- <input type="text" bind:value={filter}
      placeholder={$_('keybindingdialog.filter')}/> -->

    <table class="data">
    {#key refresh}
    <tbody>
      {#each groupedCommands() as [category, cmds]}
      <tr class='heading'>
        <td colspan="6">
          {category}
        </td>
      </tr>
      {#each cmds as cmd}
        {@const lines = cmd.bindings.length}
        {#snippet row(binding: CommandBinding)}
          {@const error = KeybindingManager.findConflict(binding, cmd).length > 0}
          <!-- keybinding -->
          <td>
            <button onclick={async () => {
              const result = await Dialogs.keybindingInput.showModal!([cmd, binding]);
              if (result) {
                binding.contexts = result.contexts;
                binding.sequence = result.sequence;
                refresh = !refresh;
                KeybindingManager.update();
              }
            }} class={{key: true, error}}>
              <kbd>{binding.sequence.map((x) => x.toString()).join(' ')}</kbd>
            </button>
          </td>
          <!-- contexts -->
          <td class="ctx">
            {#if !binding.contexts}
              {$_('keyinput.any')}
            {:else}
            <div class="ctxs hlayout">
              {#each [...binding.contexts].sort() as ctx, i}
              <span>{$_(`context.${ctx}`)}</span>
              {#if i < binding.contexts.size - 1}
              <span class="separator">|</span>
              {/if}
              {/each}
            </div>
            {/if}
          </td>
          <!-- delete -->
          <td>
            <button aria-label='delete' onclick={() => {
              const i = cmd.bindings.indexOf(binding);
              Debug.assert(i >= 0);
              cmd.bindings.splice(i, 1);
              refresh = !refresh;
              KeybindingManager.update();
            }}>
              <Trash2Icon />
            </button>
          </td>
        {/snippet}

        {#snippet addrow()}
          <td>
            <!-- add -->
            <button class="add" aria-label='add' onclick={async () => {
              const result = await Dialogs.keybindingInput.showModal!([cmd, null]);
              if (result) {
                cmd.bindings.push(result);
                refresh = !refresh;
                KeybindingManager.update();
              }
            }}>
              <PlusIcon />
            </button>
          </td>
          <td colspan="2"></td>
        {/snippet}

        <tr class="rowhead">
          <td rowspan={lines+1}>
            <!-- refresh -->
            <button aria-label="reset"
              disabled={isDefault(cmd)}
              onclick={() => {
                cmd.bindings = structuredClone(cmd.defaultBindings) as CommandBinding[];
                refresh = !refresh;
                KeybindingManager.update();
              }}
            ><RefreshCwIcon /></button>
          </td>
          <td rowspan={lines+1}>{cmd.name}</td>
          <td rowspan={lines+1}>
            {#if cmd.type == 'menu'}
              <MenuIcon />
            {:else if cmd.type == 'dialog'}
              <CreditCardIcon />
            {/if}
          </td>
          {#if lines == 0}
            {@render addrow()}
          {:else}
            {@render row(cmd.bindings[0])}
          {/if}
        </tr>
        {#each cmd.bindings.slice(1) as binding, i}
        <tr>{@render row(binding)}</tr>
        {/each}
        {#if lines > 0}
        <tr>{@render addrow()}</tr>
        {/if}
      {/each}
      {/each}
    </tbody>
    {/key}
    </table>
  </div>
</DialogBase>

<style>
  @media (prefers-color-scheme: light) {
    .error {
      background-color: lightcoral;
    }
    .rowhead {
      border-top: 1px solid var(--uchu-yin-3);
    }
    span.separator {
      color: var(--uchu-yin-5);
    }
  }
  @media (prefers-color-scheme: dark) {
    .error {
      background-color: var(--uchu-red-9);
    }
    .rowhead {
      border-top: 1px solid var(--uchu-yin-7);
    }
    span.separator {
      color: var(--uchu-yin-4);
    }
  }
  table {
    font-size: 0.9rem;
    border-collapse: collapse;
  }
  tr {
    padding: 0;
    margin: 0;
    box-sizing: content-box;
  }
  .heading {
    font-size: 0.8rem;
    font-weight: bold;
    text-transform: uppercase;
    & td {
      padding-top: 10px;
    }
  }
  .rowhead {
    vertical-align: top;
  }
  td.ctx {
    white-space: nowrap;
  }
  .key {
    width: 100%;
    text-align: start;
    box-shadow: none;
  }
  kbd {
    font-family: var(--monospaceFontFamily);
  }
  .add {
    box-shadow: none;
  }
  div.ctxs {
    justify-content: start;
    justify-items: start;
  }
  span.separator {
    padding: 0 3px 0 3px;
  }
</style>
