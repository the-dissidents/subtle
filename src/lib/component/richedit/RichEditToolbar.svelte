<script lang="ts">
  import type { SvelteHTMLElements } from "svelte/elements";
  import RichEdit from "./RichEdit.svelte";
  import { toggleMark } from "prosemirror-commands";
  import type { MarkType, Mark } from "prosemirror-model";
  import { Debug } from "../../Debug";
  import { RichTextSchema } from "./Schema";

  import { _ } from 'svelte-i18n';
  
  import { AArrowUpIcon, AArrowDownIcon, RemoveFormattingIcon } from "@lucide/svelte";

  type DIV = SvelteHTMLElements['div'];

  interface Props extends DIV {
    target?: RichEdit;
    onAction?: () => void;
  };

  const { target, onAction }: Props = $props();

  const view = $derived(target?.inner());
  const selStart = $derived(target?.selection()[0]);
  const selEnd = $derived(target?.selection()[1]);
  const updateCounter = $derived(target?.updateCounter());

  function isMarkActive(m: MarkType) {
    selStart; selEnd; updateCounter;
    if (!view) return false;
    if (selStart == selEnd)
      return !!m.isInSet(view.state.doc.resolve(selStart!).marks());
    return view.state.doc.rangeHasMark(selStart!, selEnd!, m);
  }

  const bold = toggleMark(RichTextSchema.marks.bold);
  const italic = toggleMark(RichTextSchema.marks.italic);
  const underline = toggleMark(RichTextSchema.marks.underline);
  const strikethrough = toggleMark(RichTextSchema.marks.strikethrough);

  function round(x: number) {
    return Math.round(x * 10) / 10;
  }

  function getSize(m: readonly Mark[]) {
    const size = RichTextSchema.marks.changeSize.isInSet(m);
    if (!size) return 100;
    return round(((size.attrs.value ?? 1) as number) * 100);
  }

  const currentSize = $derived.by(() => {
    selStart; selEnd; updateCounter;
    if (!view) return 100;

    if (selStart == selEnd) {
      // find size under cursor
      return getSize(view.state.doc.resolve(selStart!).marks())
    } else {
      let size: number | undefined | null;
      view.state.doc.nodesBetween(selStart!, selEnd!, (n) => {
        const s = getSize(n.marks);
        if (size === undefined) size = s;
        else if (size !== null && s !== size)
          size = null;
      });
      if (size === undefined) size = 100;
      return size;
    }
  });

  function setCurrentSize(s: number) {
    Debug.assert(view !== undefined);
    if (s <= 0) return Debug.early();

    const tr = view.state.tr;
    if (selStart == selEnd) {
      if (s !== 100)
        tr.addStoredMark(RichTextSchema.marks.changeSize.create({ value: s / 100 }));
      else
        tr.removeStoredMark(RichTextSchema.marks.changeSize);
    } else {
      if (s !== 100)
        tr.addMark(selStart!, selEnd!, RichTextSchema.marks.changeSize.create({ value: s / 100 }));
      else
        tr.removeMark(selStart!, selEnd!, RichTextSchema.marks.changeSize);
    }

    view.dispatch(tr);
    onAction?.();
  }

  function scaleSize(factor: number) {
    Debug.assert(view !== undefined);
    Debug.assert(factor != 0);

    const tr = view.state.tr;
    if (selStart == selEnd) {
      if (currentSize == null) return Debug.early();
      let s = currentSize * factor;
      if (s !== 100)
        tr.addStoredMark(RichTextSchema.marks.changeSize.create({ value: s / 100 }));
      else
        tr.removeStoredMark(RichTextSchema.marks.changeSize);
    } else {
      view.state.doc.nodesBetween(selStart!, selEnd!, (n, pos) => {
        const s = getSize(n.marks) * factor;
        const start = Math.max(selStart!, pos);
        const end = Math.min(selEnd!, pos + n.textContent.length);
        if (s !== 100)
          tr.addMark(start, end, RichTextSchema.marks.changeSize.create({ value: s / 100 }));
        else
          tr.removeMark(start, end, RichTextSchema.marks.changeSize);
      });
    }

    view.dispatch(tr);
    onAction?.();
  }

  function cleanFormatting() {
    Debug.assert(view !== undefined);

    const tr = view.state.tr;
    tr.removeMark(selStart!, selEnd!, null);
    view.dispatch(tr);
    onAction?.();
  }
</script>

<fieldset class="toolbar" disabled={!target}>
  <span class="legend">{$_('richedit.override-styles')}</span>

  <label><input type="checkbox" class="button left"
    checked={isMarkActive(RichTextSchema.marks.bold)}
    onchange={(e) => {
      e.preventDefault();
      bold(view!.state, view!.dispatch, view);
      onAction?.();
    }}><b>B</b></label>
  <label><input type="checkbox" class="button middle"
    checked={isMarkActive(RichTextSchema.marks.italic)}
    onchange={(e) => {
      e.preventDefault();
      italic(view!.state, view!.dispatch, view);
      onAction?.();
    }}><i>I</i></label>
  <label><input type="checkbox" class="button middle"
    checked={isMarkActive(RichTextSchema.marks.underline)}
    onchange={(e) => {
      e.preventDefault();
      underline(view!.state, view!.dispatch, view);
      onAction?.();
    }}><u>U</u></label>
  <label><input type="checkbox" class="button right"
    checked={isMarkActive(RichTextSchema.marks.strikethrough)}
    onchange={(e) => {
      e.preventDefault();
      strikethrough(view!.state, view!.dispatch, view);
      onAction?.();
    }}><s>S</s></label>

  <span class="separator"></span>
    
  <input type="number" min="0" max="10000" value={currentSize}
    disabled={!target}
    onchange={(x) => {
      const s = x.currentTarget.valueAsNumber;
      console.log(s);
      if (s <= 0 || isNaN(s)) {
        x.currentTarget.value = `${currentSize ?? ''}`;
        return;
      }
      setCurrentSize(s);
    }}
  >%

  <span class="separator"></span>

  <button onclick={() => scaleSize(1.1)}>
    <AArrowUpIcon/>
  </button>
  <button onclick={() => scaleSize(1 / 1.1)}>
    <AArrowDownIcon/>
  </button>

  <span class="separator"></span>

  <button disabled={selStart == selEnd}
    onclick={() => cleanFormatting()}>
    <RemoveFormattingIcon/>
  </button>
</fieldset>

<style>
  b, i, u, s {
    font-family: 'Times New Roman', Times, serif;
  }

  .toolbar {
    display: flex;
    flex-direction: row;
    padding: 5px;
    margin-block: 2px;
    border-radius: 3px;
    border: 1px solid var(--uchu-gray-4);
    min-width: none;
    overflow-x: scroll;

    @media (prefers-color-scheme: dark) {
      border-color: var(--uchu-yin-7);
    }

    & label {
      padding-inline: 15px;
      width: 3em;
      min-width: 1em;
      text-align: center !important;
    }
  }

  .legend {
    color: gray;
    margin-right: 1em;
    word-break: keep-all;
  }

  .separator {
    margin-inline: 10px;
    border-left: 1px solid lightgray;
  }
</style>