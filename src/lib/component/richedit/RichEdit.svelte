<script lang="ts">
  import { EditorState, Plugin, TextSelection } from "prosemirror-state";
  import { EditorView } from "prosemirror-view";
  import { undo, redo, history } from "prosemirror-history";
  import { keymap } from "prosemirror-keymap";
  import { baseKeymap, chainCommands, deleteSelection, exitCode, joinBackward, joinForward, newlineInCode, selectAll, selectNodeBackward, selectNodeForward, toggleMark } from "prosemirror-commands";

  import { fromRichText, RichTextSchema, toRichText } from "./Schema";
  import { onMount } from "svelte";
  import { Mark, MarkType } from "prosemirror-model";
  import { VirtualSelection } from "./VirtualSelection";
  
  import { Debug } from "../../Debug";
  import { AArrowDownIcon, AArrowUpIcon, X } from "@lucide/svelte";
  import type { RichText } from "../../core/RichText";
  import { hook } from "../../details/Hook.svelte";

  import type { SvelteHTMLElements } from 'svelte/elements';

  type DIV = SvelteHTMLElements['div'];

  interface Props extends DIV {
    text: RichText,
    init?: () => void,
    onBlur?: (x: RichText) => void,
    onFocus?: (x: RichText) => void,
    onInput?: (x: RichText) => void,
  };

  let { text = $bindable(), onBlur, onFocus, onInput, init, ...rest }: Props = $props();

  export function getText() {
    return text;
  }

  export function blur() {
    container?.blur();
  }

  export function focus() {
    view?.focus();
  }

  export function scrollIntoView() {
    container?.scrollIntoView();
  }

  export function setSelectionRange(start: number, end: number) {
    view?.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, start, end)));
  }

  let container: HTMLDivElement | undefined;
  let view: EditorView | undefined;

  let selStart = $state(0);
  let selEnd = $state(0);
  let updateCounter = $state(0);

  hook(() => text, (x) => {
    if (!view) return Debug.early();

    const doc = fromRichText(x);
    if (doc.eq(view.state.doc)) return;

    view.updateState(EditorState.create({
      schema: view.state.schema,
      plugins: view.state.plugins,
      doc
    }));
  });

  onMount(() => {
    const backspace = chainCommands(deleteSelection, joinBackward, selectNodeBackward);
    const del = chainCommands(deleteSelection, joinForward, selectNodeForward);

    let state = EditorState.create({
      schema: RichTextSchema,
      doc: fromRichText(text),
      plugins: [
        history(),
        keymap({
          "Shift-Enter": newlineInCode,
          "Backspace": backspace,
          "Mod-Backspace": backspace,
          "Shift-Backspace": backspace,
          "Delete": del,
          "Mod-Delete": del,
          "Mod-a": selectAll,

          "Mod-z": undo, 
          "Mod-y": redo,
          "Mod-b": bold,
          "Mod-i": italic,
          "Mod-u": underline,
        }),
        VirtualSelection,
        new Plugin({
          appendTransaction(tr, oldState, newState) {
            if (!oldState.selection.eq(newState.selection)) {
              selStart = newState.selection.from;
              selEnd = newState.selection.to;
            }
            if (tr.find((x) => x.docChanged)) {
              updateCounter++;
              text = toRichText(newState.doc);
              onInput?.(text);
            }
            return null;
          },
          props: {
            handleDOMEvents: {
              "blur"() {
                onBlur?.(text);
              },
              "focus"() {
                onFocus?.(text);
              },
            }
          }
        }),
      ]
    });
    view = new EditorView(container!, { state });
    init?.();
  });

  function isMarkActive(m: MarkType) {
    selStart; selEnd; updateCounter;
    if (!view) return false;
    if (selStart == selEnd)
      return !!m.isInSet(view.state.doc.resolve(selStart).marks());
    return view.state.doc.rangeHasMark(selStart, selEnd, m);
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
      return getSize(view.state.doc.resolve(selStart).marks())
    } else {
      let size: number | undefined | null;
      view.state.doc.nodesBetween(selStart, selEnd, (n) => {
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
        tr.addMark(selStart, selEnd, RichTextSchema.marks.changeSize.create({ value: s / 100 }));
      else
        tr.removeMark(selStart, selEnd, RichTextSchema.marks.changeSize);
    }

    view.dispatch(tr);
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
      view.state.doc.nodesBetween(selStart, selEnd, (n, pos) => {
        const s = getSize(n.marks) * factor;
        const start = Math.max(selStart, pos);
        const end = Math.min(selEnd, pos + n.textContent.length);
        if (s !== 100)
          tr.addMark(start, end, RichTextSchema.marks.changeSize.create({ value: s / 100 }));
        else
          tr.removeMark(start, end, RichTextSchema.marks.changeSize);
      });
    }

    view.dispatch(tr);
  }
</script>

<div class="toolbar">
  <label><input type="checkbox" class="button left"
    checked={isMarkActive(RichTextSchema.marks.bold)}
    onchange={(e) => {
      e.preventDefault();
      bold(view!.state, view!.dispatch, view);
    }}><b>B</b></label>
  <label><input type="checkbox" class="button middle"
    checked={isMarkActive(RichTextSchema.marks.italic)}
    onchange={(e) => {
      e.preventDefault();
      italic(view!.state, view!.dispatch, view);
    }}><i>I</i></label>
  <label><input type="checkbox" class="button middle"
    checked={isMarkActive(RichTextSchema.marks.underline)}
    onchange={(e) => {
      e.preventDefault();
      underline(view!.state, view!.dispatch, view);
    }}><u>U</u></label>
  <label><input type="checkbox" class="button right"
    checked={isMarkActive(RichTextSchema.marks.strikethrough)}
    onchange={(e) => {
      e.preventDefault();
      strikethrough(view!.state, view!.dispatch, view);
    }}><s>S</s></label>

  <span class="separator"></span>
    
  <input type="number" min="0" max="10000" value={currentSize} onchange={(x) => {
    const s = x.currentTarget.valueAsNumber;
    console.log(s);
    if (s <= 0 || isNaN(s)) {
      x.currentTarget.value = `${currentSize ?? ''}`;
      return;
    }
    setCurrentSize(s);
  }}>%

  <span class="separator"></span>

  <button onclick={() => scaleSize(1.1)}>
    <AArrowUpIcon/>
  </button>
  <button onclick={() => scaleSize(1 / 1.1)}>
    <AArrowDownIcon/>
  </button>
</div>

<div bind:this={container} class="editor"
  {...rest}></div>

<style>
  b, i, u, s {
    font-family: 'Times New Roman', Times, serif;
  }
  div.toolbar {
    width: 100%;
    display: flex;
    flex-direction: row;
    & label {
      padding-inline: 15px;
    }
  }
  div.editor {
    width: 100%;
    min-height: 1lh;
    white-space: pre-wrap;
  }

  :global(.virtual-selection) {
    background-color: gainsboro;
    height: 1lh;
  }

  .separator {
    width: 20px;
  }
</style>