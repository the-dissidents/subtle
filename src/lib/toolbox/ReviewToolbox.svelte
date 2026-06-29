<script lang="ts">
import { CompiledLintProfile } from "../core/LintProfile";
import { RichText } from "../core/RichText";
import type { SubtitleStyle } from "../core/Subtitles.svelte";
  import { Frontend } from "../frontend/Frontend";
import { ChangeType, Source } from "../frontend/Source";
import { Diagnostic } from "../linter/Common";

import { _ } from 'svelte-i18n';

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
</script>

<div class='vlayout fill'>
  <h5>拼写检查</h5>
  <div>
    <button>上一个问题</button>
    <button>下一个问题</button>
    <button onclick={() => fixAll()}>尝试修复所有问题</button>
  </div>
</div>
