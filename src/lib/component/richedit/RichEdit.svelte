<script lang="ts">
  import { EditorState, Plugin, TextSelection } from "prosemirror-state";
  import { EditorView } from "prosemirror-view";
  import { undo, redo, history } from "prosemirror-history";
  import { keymap } from "prosemirror-keymap";
  import { chainCommands, deleteSelection, joinBackward, joinForward, newlineInCode, selectAll, selectNodeBackward, selectNodeForward, toggleMark } from "prosemirror-commands";

  import { fromRichText, RichTextSchema, toRichText } from "./Schema";
  import { VirtualSelection } from "./VirtualSelection";

  import { Debug } from "../../Debug";
  import { RichText } from "../../core/RichText";
  import { hook } from "../../details/Hook.svelte";

  import { onDestroy, onMount, untrack } from "svelte";
  import type { SvelteHTMLElements } from 'svelte/elements';
  import { Linter, LinterKey } from "./Lint";
  import type { CompiledLintProfile } from "../../core/LintProfile";
  import { RestartableTask } from "../../details/RestartableTask";
  import { Popup } from "@the_dissidents/svelte-ui";
  import type { Diagnostic } from "../../linter/Common";
  import { ArrowRightIcon } from "@lucide/svelte";
  import { Basic } from "../../Basic";

  type DIV = SvelteHTMLElements['div'];

  interface Props extends DIV {
    text: RichText,
    linter?: CompiledLintProfile,
    deinit?: (x: RichText) => void,
    onBlur?: (x: RichText) => void,
    onFocus?: (x: RichText) => void,
    onInput?: (x: RichText) => void,
  };

  let { text = $bindable(), linter, onBlur, onFocus, onInput, deinit, ...rest }: Props = $props();

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

  let popup: Popup;
  let popupDiags: Diagnostic[] = $state([]);

  hook(() => text, (x) => {
    if (!view) return Debug.early();

    const doc = fromRichText(x);
    if (doc.eq(view.state.doc)) return;

    view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, doc));
  });

  const backspace = chainCommands(deleteSelection, joinBackward, selectNodeBackward);
  const del = chainCommands(deleteSelection, joinForward, selectNodeForward);

  const bold = toggleMark(RichTextSchema.marks.bold);
  const italic = toggleMark(RichTextSchema.marks.italic);
  const underline = toggleMark(RichTextSchema.marks.underline);

  const lintTask = new RestartableTask(async ([linter]: [CompiledLintProfile]) => {
    if (!view) return;
    const diagnostics = linter.check(RichText.toString(text));
    await Basic.wait(0); // prevent nested transaction
    view.dispatch(view.state.tr.setMeta(LinterKey, diagnostics));
  }, { debounceMs: 0 });

  $effect(() => {
    if (linter) untrack(() => void lintTask.request(linter));
  });

  onMount(() => {
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
        new Plugin({
          appendTransaction(tr, oldState, newState) {
            if (!oldState.selection.eq(newState.selection)) {
              selStart = newState.selection.from;
              selEnd = newState.selection.to;
            }
            if (tr.find((x) => x.docChanged)) {
              update++;
              text = toRichText(newState.doc);
              if (linter)
                void lintTask.request(linter);
              onInput?.(text);
            }
            return null;
          },
          props: {
            handleDOMEvents: {
              "blur"() { onBlur?.(text); },
              "focus"() { onFocus?.(text); },
            }
          }
        }),
        VirtualSelection,
        Linter((d, rect) => {
          popupDiags = d;
          popup.open(rect);
        }, () => {
          if (popup.openState())
            popup.close();
        }),
      ]
    });
    view = new EditorView(container!, { state });
    if (linter) void lintTask.request(linter);
  });

  onDestroy(() => {
    deinit?.(text);
  });
</script>

<div bind:this={container} class="editor"
  {...rest}>
</div>

<Popup bind:this={popup} position='bottom'>
  {#each popupDiags as d, i}
    {d.description}
    {#if d.fix}
      <button class="fix" onclick={() => {
        Debug.assert(!!view);
        popup.close();
        view.focus();

        const substitute = d.fix!.substitute;
        const tr = view.state.tr.insertText(substitute, d.start, d.to);
        tr.setSelection(TextSelection.create(tr.doc, d.start, d.start + substitute.length));
        view.dispatch(tr);
      }}>
        <ArrowRightIcon/>
        <code>{d.fix.substitute}</code>
      </button>
    {/if}
    {#if i < popupDiags.length - 1}
      <hr>
    {/if}
  {/each}
</Popup>

<style lang='scss'>
  div.editor {
    width: 100%;
    min-height: 1lh;
    white-space: pre-wrap;
    font-synthesis: style;

    :global(.virtual-selection) {
      background-color: gainsboro;
      height: 1lh;
    }

    :global(.lint) {
      text-decoration: red underline;
      background-color: pink;
    }
  }

  .fix {
    display: inline-block;

    code {
      white-space: pre-wrap;
      background-color: #eee;
      border-radius: 3px;
      padding: 0 3px;
    }
    :global(.lucide) {
      display: inline;
      height: 1em;
      width: 1em;
      vertical-align: middle;
    }
  }
</style>
