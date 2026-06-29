<script lang="ts">
  import { _ } from "svelte-i18n";
  import { SavedLintProfiles } from "./frontend/LintProfiles";
  import { lintProfileEquals, type LintProfile } from "./core/LintProfile";
  import { PencilIcon, SaveIcon, Trash2Icon } from "@lucide/svelte";
  import { Popup } from "@the_dissidents/svelte-ui";
  import { showInputPopup } from "./ui/InputPopup.svelte";
  import { Debug } from "./Debug";
  import { showConfirmationPopup } from "./ui/ConfirmationPopup.svelte";

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
    <button disabled={!!selectedPreset} onclick={async (e) => {
      const name = await showInputPopup(e.currentTarget, $_('lint.name-for-new-preset'), {
        validate: (s) => s.length > 0 && !$SavedLintProfiles.find(([name, _]) => name == s),
        position: 'top'
      });
      if (name) {
        $SavedLintProfiles.push([name, value]);
        SavedLintProfiles.markChanged();
      }
    }}>
      <SaveIcon />
    </button>
    <button disabled={!selectedPreset} onclick={async (e) => {
      const name = await showInputPopup(e.currentTarget, $_('lint.rename-to'), {
        validate: (s) => s.length > 0 && !$SavedLintProfiles.find(([name, _]) => name == s),
        position: 'top'
      });
      if (name) {
        const i = $SavedLintProfiles.findIndex(([_, p]) => p == selectedPreset);
        Debug.assert(i >= 0 && !!selectedPreset);
        $SavedLintProfiles[i] = [name, selectedPreset!];
        SavedLintProfiles.markChanged();
      }
    }}><PencilIcon /></button>
    <button disabled={!selectedPreset} onclick={async (e) => {
      if (!await showConfirmationPopup(e.currentTarget, $_('lint.confirm-delete')))
        return;
      const i = $SavedLintProfiles.findIndex(([_, p]) => p === selectedPreset);
      Debug.assert(i >= 0);
      $SavedLintProfiles = $SavedLintProfiles.toSpliced(i, 1);
      SavedLintProfiles.markChanged();
    }}><Trash2Icon /></button>
  {/if}
</div>

<Popup>

</Popup>
