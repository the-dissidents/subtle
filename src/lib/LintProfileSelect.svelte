<script lang="ts">
  import { _ } from "svelte-i18n";
  import { SavedLintProfiles } from "./frontend/LintProfiles";
  import { lintProfileEquals, type LintProfile } from "./core/LintProfile";
  import { PencilIcon, SaveIcon, Trash2Icon } from "@lucide/svelte";
  import { Popup } from "@the_dissidents/svelte-ui";

  const { value, onChange, allowManage }: {
    value: LintProfile,
    allowManage?: boolean,
    onChange?: (v: LintProfile | null) => void,
  } = $props();

  const selectedPreset = $derived.by(() => {
    const found = $SavedLintProfiles.find(([_, p]) => lintProfileEquals(p, value));
    return found?.[1] ?? null;
  });
</script>

<div class="hlayout">
  <select class="flexgrow" bind:value={() => selectedPreset, (x) => onChange?.(x)}>
    {#each $SavedLintProfiles as [name, preset]}
      <option value={preset}>{name}</option>
    {/each}
    <hr>
    <option value={null}>{$_('lint.custom')}</option>
  </select>
  {#if allowManage}
    <button disabled={!!selectedPreset}><SaveIcon /></button>
    <button disabled={!selectedPreset}><PencilIcon /></button>
    <button disabled={!selectedPreset}><Trash2Icon /></button>
  {/if}
</div>

<Popup>

</Popup>
