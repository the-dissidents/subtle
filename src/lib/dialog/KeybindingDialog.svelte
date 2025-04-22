<script lang="ts">
import { Debug } from '../Debug';
import DialogBase from '../DialogBase.svelte';
import { Commands } from '../frontend/Commands';
import { Dialogs, type DialogHandler } from '../frontend/Dialogs';
import { _, locale } from 'svelte-i18n';
import { bindingToString, KeybindingManager, type CommandBinding, type KeyBinding } from '../frontend/Keybinding';

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
let filter = $state('');
let commands = Object.entries(Commands);
let refresh = $state(false);

locale.subscribe(() => refresh = !refresh);

</script>

{#snippet icon(name: string)}
{#if name}
  <svg class="feather" style="padding: 2px;">
    <use href={`/feather-sprite.svg#${name}`} />
  </svg>
{/if}
{/snippet}

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
      {#each commands as [key, cmd]}
        {@const lines = cmd.bindings.length}
        {#snippet row(binding: CommandBinding)}
          {@const error = KeybindingManager.findConflict(binding, cmd).length > 0}
          <td>
            <button onclick={async () => {
              // edit keybinding
              const result = await Dialogs.keybindingInput.showModal!([cmd, binding]);
              if (result) {
                binding.contexts = result.contexts;
                binding.sequence = result.sequence;
                refresh = !refresh;
                KeybindingManager.update();
              }
            }} class={{key: true, error}}>
              <kbd>{binding.sequence.map(bindingToString).join(' ')}</kbd>
            </button>
          </td>
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
          <td>
            <button aria-label='delete' onclick={() => {
                // delete keybinding
                const i = cmd.bindings.indexOf(binding);
                Debug.assert(i >= 0);
                cmd.bindings.splice(i, 1);
                refresh = !refresh;
                KeybindingManager.update();
            }}>
              <svg class="feather">
                <use href={`/feather-sprite.svg#trash-2`} />
              </svg>
            </button>
          </td>
        {/snippet}

        {#snippet addrow()}
          <td class={{major: true}}>
            <button class="add" aria-label='add' onclick={async () => {
              // new keybinding
              const result = await Dialogs.keybindingInput.showModal!([cmd, null]);
              if (result) {
                cmd.bindings.push(result);
                refresh = !refresh;
                KeybindingManager.update();
              }
            }}>
              <svg class="feather">
                <use href={`/feather-sprite.svg#plus`} />
              </svg>
            </button>
          </td>
          <td colspan="2" class={{major: true}}></td>
        {/snippet}

        <tr>
          <!-- TODO: category -->
          <td class="rowhead" rowspan={lines+1}>
            <button aria-label="reset" onclick={() => {
              cmd.bindings = structuredClone(cmd.defaultBindings) as CommandBinding[];
              refresh = !refresh;
              KeybindingManager.update();
            }}>
              <svg class="feather">
                <use href={`/feather-sprite.svg#refresh-cw`} />
              </svg>
            </button>
          </td>
          <td class="rowhead" rowspan={lines+1}>{cmd.name}</td>
          <td class="rowhead" rowspan={lines+1}>
            {@render icon(
                cmd.type == 'menu' ? 'menu' 
              : cmd.type == 'dialog' ? 'credit-card'
              : '')}
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
    .rowhead, .major {
      border-bottom: 1px solid var(--uchu-yin-5);
    }
    span.separator {
      color: var(--uchu-yin-5);
    }
  }
  @media (prefers-color-scheme: dark) {
    .error {
      background-color: var(--uchu-red-9);
    }
    .rowhead, .major {
      border-bottom: 1px solid var(--uchu-yin-7);
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
    padding: 6px 0 6px 0;
    box-sizing: content-box;
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
