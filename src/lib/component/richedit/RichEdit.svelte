<script lang="ts">
  import { EditorState, Plugin, TextSelection } from "prosemirror-state";
  import { EditorView } from "prosemirror-view";
  import { undo, redo, history } from "prosemirror-history";
  import { keymap } from "prosemirror-keymap";
  import { chainCommands, deleteSelection, joinBackward, joinForward, newlineInCode, selectAll, selectNodeBackward, selectNodeForward, toggleMark } from "prosemirror-commands";

  import { fromRichText, RichTextSchema, toRichText } from "./Schema";
  import { onDestroy, onMount } from "svelte";
  import { VirtualSelection } from "./VirtualSelection";
  
  import { Debug } from "../../Debug";
  import type { RichText } from "../../core/RichText";
  import { hook } from "../../details/Hook.svelte";

  import type { SvelteHTMLElements } from 'svelte/elements';

  type DIV = SvelteHTMLElements['div'];

  interface Props extends DIV {
    text: RichText,
    deinit?: () => void,
    onBlur?: (x: RichText) => void,
    onFocus?: (x: RichText) => void,
    onInput?: (x: RichText) => void,
  };

  let { text = $bindable(), onBlur, onFocus, onInput, deinit, ...rest }: Props = $props();

  export function selection() {
    return [selStart, selEnd] as const;
  }

  export function updateCounter() {
    return update;
  }

  export function inner() {
    return view;
  }

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
  let update = $state(0);

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
              update++;
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
  });

  onDestroy(() => {
    deinit?.();
  });

  const bold = toggleMark(RichTextSchema.marks.bold);
  const italic = toggleMark(RichTextSchema.marks.italic);
  const underline = toggleMark(RichTextSchema.marks.underline);
</script>

<div bind:this={container} class="editor"
  {...rest}></div>

<style>
  div.editor {
    width: 100%;
    min-height: 1lh;
    white-space: pre-wrap;
    font-synthesis: style;
  }

  :global(.virtual-selection) {
    background-color: gainsboro;
    height: 1lh;
  }
</style>