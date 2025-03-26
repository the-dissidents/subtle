<script lang="ts">
import type { DialogHandler } from '../frontend/Dialogs';
import DialogBase from '../DialogBase.svelte';
import { assert, never } from '../Basic';
import { InterfaceConfig, MainConfig } from "../config/Groups";
import type { PublicConfigGroup, PublicConfigGroupDefinition } from '../config/PublicConfig.svelte';
import { revealItemInDir } from '@tauri-apps/plugin-opener';

import { _, locale } from 'svelte-i18n';

interface Props {
  handler: DialogHandler<void, void>;
}

let {
  handler = $bindable()
}: Props = $props();

handler.showModal = async () => {
  assert(inner !== undefined);
  groups = Object.entries(MainConfig.groups);
  groups.sort((a, b) => a[1].priority - b[1].priority);
  await inner.showModal!();
  await MainConfig.save();
};

let inner: DialogHandler<void> = {}
let groups = $state<[string, PublicConfigGroup<PublicConfigGroupDefinition>][]>([]);
let refresh = $state(0);

locale.subscribe(() => refresh++);
</script>

<DialogBase handler={inner} maxWidth="36em" buttons={[{
  name: 'ok',
  localizedName: $_('ok')
}]}>
  {#snippet header()}
    <h3>{$_('menu.configuration')}</h3>
  {/snippet}

  <div class="hlayout">
    <p class='notice flexgrow'>
      {$_('configdialog.all-items-are-automatically-saved')}
    </p>
    <button onclick={() => {
      revealItemInDir(MainConfig.configPath);
    }}>{$_('configdialog.show-config-file-advanced')}</button>
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
                <input type="number" value={group.data[key]} 
                     min={item.bounds[0]} max={item.bounds[1]}
                     step={item.type == 'integer' ? 1 : 'any'}
                     onchange={async (ev) => {
                    if (ev.currentTarget.validity.valid)
                      group.data[key] = ev.currentTarget.valueAsNumber;
                    else
                      ev.currentTarget.value = group.data[key].toString();
                     }}/>
                <input type="range" class="flexgrow"
                  min={item.bounds[0]} max={item.bounds[1]}
                  step={item.type == 'integer' ? 1 : 'any'}
                  bind:value={group.data[key]} 
                  onchange={async () => await MainConfig.save()}/>
              </div>
            {:else}
              <input class="stretch" type="number" value={group.data[key]} 
                min={item.bounds?.[0]} max={item.bounds?.[1]}
                step={item.type == 'integer' ? 1 : 'any'}
                onchange={async (ev) => {
                  if (ev.currentTarget.validity.valid)
                    group.data[key] = ev.currentTarget.valueAsNumber;
                  else
                    ev.currentTarget.value = group.data[key].toString();
                }}/>
            {/if}

          {:else}
            {never(item)}
          {/if}
        </td>
        <td style="text-align: end;"><button
          disabled={group.data[key] === group.defaults[key]}
          onclick={() => group.data[key] = group.defaults[key]}
        >reset</button></td>
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
h3.groupname {
  margin: 0 0 3px 0;
  text-align: start;
  font-size: 100%;
  font-weight: bold;
  border-bottom: 1px solid gray;
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
  border-bottom: dashed 1px var(--uchu-yin-2);
  height: 0.75lh;
}

input[type='checkbox'] {
  width: auto;
}
input[type='radio'] {
  width: auto;
}
.hlayout input[type='number'] {
  width: 60px;
}
input.stretch {
  width: 100%;
}
label {
  font-size: 90%;
}
td.description {
  color: var(--uchu-yin-6);
  font-size: 90%;
  text-align: justify;
  padding-left: 50px;
  margin: 5px 0 5px 0;
  line-height: 1.4em;
}
p.description {
  color: var(--uchu-yin-8);
  font-size: 90%;
  text-align: justify;
  margin: 5px 0 5px 0;
  line-height: 1.4em;
}
.notice {
  color: var(--uchu-yin-8);
  font-size: 90%;
  margin: 0 0 5px 0;
}
</style>