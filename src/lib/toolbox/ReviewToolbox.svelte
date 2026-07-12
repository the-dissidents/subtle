<script lang="ts">
import { Memorized } from "../config/MemorizedValue.svelte";
import { CompiledLintProfile } from "../core/LintProfile";
import { RichText } from "../core/RichText";
import { SubtitleEntry, type SubtitleStyle } from "../core/Subtitles.svelte";
import { Debug } from "../Debug";
import { Editing, SelectMode } from "../frontend/Editing";
import { Frontend } from "../frontend/Frontend";
import { ChangeCause, ChangeType, Source } from "../frontend/Source";
import { Diagnostic } from "../linter/Common";

import { ConfigRow, ConfigTable } from "@the_dissidents/svelte-ui";
import { _ } from 'svelte-i18n';
import * as z from 'zod/mini';

function getLinters() {
  return new Map(Source.subs.styles.map((x) =>
    [x, x.lintProfile ? new CompiledLintProfile(x.lintProfile) : undefined] as const));
}

async function fixAll() {
  const linters = getLinters();

  let nChanged = 0, nTotal = 0;
  Source.subs.entries.forEach((ent) => {
    const modifications: [SubtitleStyle, RichText][] = [];

    ent.texts.forEach((text, style) => {
      const linter = linters.get(style);
      if (!linter) return;

      const result = linter.check(RichText.toString(text));
      if (result.length > 0) nTotal++;
      else return;

      const fixes = Diagnostic.getNonOverlappingFixes(result);
      let newText = text, changed = false;
      fixes.forEach((f) => {
        newText = RichText.edit(newText, f.start, f.to - f.start,
          RichText.leaf(f.substitute, ...RichText.attrsAt(newText, f.start)));
        changed = true;
      });
      if (changed) {
        nChanged++;
        modifications.push([style, newText]);
      }
    });
    modifications.forEach(([s, t]) => ent.texts.set(s, t));
  });

  if (nTotal == 0) {
    Frontend.setStatus($_('review.nothing-to-fix'));
  } else {
    if (nChanged > 0)
      await Source.markChanged(ChangeType.InPlace, $_('c.fix-lint-problems'));

    Frontend.setStatus(
      $_('review.auto-fix-problems', { values: { n: nChanged, m: nTotal - nChanged } })
    + (nTotal > nChanged
      ? $_('review.n-problems-cannot-be-fixed-automatically', { values: {n: nTotal - nChanged} })
      : ''))
  }
}

let checkLint = Memorized.$('review-goto-lint', z.boolean(), true);
let checkFilter = Memorized.$('review-goto-filter', z.boolean(), true);

let focusedEntry = Editing.focused.entry;

async function gotoProblem(dir: 1 | -1) {
  if (!($focusedEntry instanceof SubtitleEntry)) return;

  const linters = getLinters();
  let i = Source.subs.entries.indexOf($focusedEntry);
  Debug.assert(i >= 0);
  i += dir;
  while (i >= 0 && i < Source.subs.entries.length) {
    const ent = Source.subs.entries[i];
    const hasProblem = [...ent.texts.entries()].find(
      ([style, text]) => {
        const linter = linters.get(style);
        if (!linter) return false;
        return linter.check(RichText.toString(text)).length > 0;
      });
    if (hasProblem) {
      await Editing.selectEntry(ent, SelectMode.Single, ChangeCause.Action);
      Frontend.setStatus(dir > 0 ? $_('review.found-next') : $_('review.found-previous'));
      return;
    }

    i += dir;
  }
  Frontend.setStatus(
    dir > 0 ? $_('review.not-found-next') : $_('review.not-found-previous'), 'error');
}
</script>

<div class='vlayout fill'>
  <h5>导航</h5>
  <ConfigTable>
    <ConfigRow name=''>
      <label>
        <input type='checkbox' bind:checked={$checkLint}>
        拼写检查问题
      </label>
      <br>
      <label>
        <input type='checkbox' bind:checked={$checkFilter}>
        不符合验证条件的条目
      </label>
    </ConfigRow>
    <ConfigRow name='前往'>
      <div>
        <button disabled={!($focusedEntry instanceof SubtitleEntry)}
          onclick={() => gotoProblem(-1)}>上一个</button>
        <button disabled={!($focusedEntry instanceof SubtitleEntry)}
          onclick={() => gotoProblem(1)}>下一个</button>
      </div>
    </ConfigRow>
  </ConfigTable>

  <h5>拼写检查</h5>
  <div>
    <button onclick={() => fixAll()}>尝试修复所有拼写问题</button>
  </div>
</div>
