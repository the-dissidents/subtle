<script lang="ts">
import { openPath, revealItemInDir } from '@tauri-apps/plugin-opener';
import { MainConfig } from "../config/Groups";
import type { PublicConfigGroup, PublicConfigGroupDefinition } from '../config/PublicConfig.svelte';
import { Debug } from "../Debug";
import DialogBase from '../DialogBase.svelte';
import type { DialogHandler } from '../frontend/Dialogs';

import { appLocalDataDir, appLogDir } from "@tauri-apps/api/path";
import { _, locale } from 'svelte-i18n';
import { Interface } from '../frontend/Interface';
import NumberInput from '../ui/NumberInput.svelte';
import { RefreshCcwIcon } from '@lucide/svelte';

interface Props {
  handler: DialogHandler<void, void>;
}

let {
  handler = $bindable()
}: Props = $props();

handler.showModal = async () => {
  Debug.assert(inner !== undefined);
  groups = Object.entries(MainConfig.groups);
  groups.sort((a, b) => a[1].priority - b[1].priority);
  await inner.showModal!();
  await Interface.savePublicConfig();
};

let inner: DialogHandler<void> = {}
let groups = $state<[string, PublicConfigGroup<PublicConfigGroupDefinition>][]>([]);
let refresh = $state(0);

locale.subscribe(() => refresh++);
</script>

<DialogBase handler={inner} maxWidth="40em" buttons={[{
  name: 'ok',
  localizedName: () => $_('ok')
}]}>
  {#snippet header()}
    <h3>{$_('menu.configuration')}</h3>
  {/snippet}

  <div class="hlayout">
    <p class='notice flexgrow'>
      {$_('configdialog.all-items-are-automatically-saved')}
    </p>
    <div class='vlayout'>
      <button onclick={() => {
        revealItemInDir(MainConfig.configPath);
      }}>{$_('configdialog.show-config-file-advanced')}</button>
      <button onclick={async () => {
        openPath(await appLogDir());
      }}>{$_('configdialog.show-log-path')}</button>
      <button onclick={async () => {
        openPath(await appLocalDataDir());
      }}>{$_('configdialog.show-autosave-path')}</button>
    </div>
  </div>
  
  {#key refresh}
  {#each groups as [_gkey, group]}
  {@const items = Object.entries(group.definition)}
    <h3 class="groupname">
      {group.name()}
    </h3>

    {#if group.description}
    <p class='description'>{group.description()}</p>
    {/if}

    <table>
    <tbody>
    {#each items as [key, item]}
      <tr>
        <td class="key hlayout">
          <span>{item.localizedName()}</span>
          <span class='line'></span>
        </td>
        <td>
          {#if item.type == 'select'}
          {@const options = Object.entries(item.options)}
          {#each options as [optkey, option]}
            <label>
              <input type="radio" bind:group={group.data[key]} value={optkey}
                   onchange={async () => await MainConfig.save()}/>
              {option.localizedName()}
            </label><br/>
            {#if option.description}
            <p class='description'>{option.description()}</p>
            {/if}
          {/each}

          {:else if item.type == 'dropdown'}
          {@const options = Object.entries(item.options)}
          <select bind:value={group.data[key]}
              onchange={async () => await MainConfig.save()}>
            {#each options as [optkey, option]}
              <option value={optkey}>{option.localizedName()}</option>
            {/each}
          </select>

          {:else if item.type == 'boolean'}
          <input type="checkbox" bind:checked={group.data[key] as boolean} />

          {:else if item.type == 'string'}
            <input class="stretch" type="text"
                 autocapitalize="none" autocomplete="off" spellcheck="false"
                 bind:value={group.data[key]}
                 onchange={async () => await MainConfig.save()}/>

          {:else if item.type == 'number' || item.type == 'integer'}
            {#if item.bounds !== undefined 
              && item.bounds[0] !== null 
              && item.bounds[1] !== null}
              <div class="hlayout stretch">
                <NumberInput bind:value={group.data[key] as number}
                  width="60px"
                  min={item.bounds[0]} max={item.bounds[1]}
                  step={item.type == 'integer' ? 1 : 'any'} />
                <input type="range" class="flexgrow"
                  min={item.bounds[0]} max={item.bounds[1]}
                  step={item.type == 'integer' ? 1 : 'any'}
                  bind:value={group.data[key]} 
                  onchange={async () => await MainConfig.save()}/>
              </div>
            {:else}
              <NumberInput bind:value={group.data[key] as number}
                class="stretch" 
                min={item.bounds?.[0]} max={item.bounds?.[1]}
                step={item.type == 'integer' ? 1 : 'any'} />
            {/if}

          {:else}
            {Debug.never(item)}
          {/if}
        </td>
        <td style="text-align: end;">
          <button aria-label="reset"
            disabled={group.data[key] === group.defaults[key]}
            onclick={() => group.data[key] = group.defaults[key]}
          >
            <RefreshCcwIcon />
          </button></td>
      </tr>

      {#if item.description}
      <tr>
        <td colspan="3" class='description'>
          {item.description()}
        </td>
      </tr>
      {/if}
    {/each}
    </tbody>
    </table>
  {/each}
  {/key}
</DialogBase>

<style>
@media (prefers-color-scheme: light) {
  h3.groupname {
    border-bottom: 1px solid gray;
  }
  .line {
    border-bottom: dashed 1px var(--uchu-yin-2);
  }
  td.description {
    color: var(--uchu-yin-6);
  }
  p.description {
    color: var(--uchu-yin-8);
  }
  .notice {
    color: var(--uchu-yin-8);
  }
}

@media (prefers-color-scheme: dark) {
  h3.groupname {
    border-bottom: 1px solid gray;
  }
  .line {
    border-bottom: dashed 1px var(--uchu-yin-6);
  }
  td.description {
    color: var(--uchu-yin-4);
  }
  p.description {
    color: var(--uchu-yin-2);
  }
  .notice {
    color: var(--uchu-yin-2);
  }
}

h3.groupname {
  margin: 0 0 3px 0;
  text-align: start;
  font-size: 100%;
  font-weight: bold;
}
table {
  margin-bottom: 20px;
  width: 100%;
}

table td.key {
  white-space: nowrap;
}

.line {
  flex-grow: 1;
  margin-left: 5px;
  height: 0.75lh;
}

input[type='checkbox'] {
  width: auto;
}
input[type='radio'] {
  width: auto;
}
.stretch {
  width: 100%;
}
label {
  font-size: 90%;
}
td.description {
  font-size: 90%;
  text-align: justify;
  padding-left: 50px;
  margin: 5px 0 5px 0;
  line-height: 1.4em;
}
p.description {
  font-size: 90%;
  text-align: justify;
  margin: 5px 0 5px 0;
  line-height: 1.4em;
}
.notice {
  font-size: 90%;
  margin: 0 0 5px 0;
  align-content: end;
}
</style>