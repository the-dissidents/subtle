import type { Node } from "prosemirror-model";
import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet, EditorView } from "prosemirror-view";
import type { Diagnostic } from "../../linter/Common";
import { Debug } from "../../Debug";

function lintDeco(doc: Node, diags: Diagnostic[]) {
  return DecorationSet.create(doc,
    diags.map((x) => Decoration.inline(x.start, x.to, { class: "lint" }, { diag: x })));
}

export const LinterKey = new PluginKey<Diagnostic[]>('Linter');

function getDiag(view: EditorView, plugin: Plugin<DecorationSet>, dom: Element) {
    const pos = view.posAtDOM(dom, 0);
    const found = plugin.getState(view.state)!
        .find(pos, pos).map((x) => x.spec.diag as Diagnostic);
    return found;
}

export const Linter = (
    initial: Diagnostic[] = [],
    show: (d: Diagnostic[], rect: DOMRect) => void,
    _hide: () => void,
) => new Plugin({
  state: {
    init(_, {doc}) {
        return lintDeco(doc, initial);
    },
    apply(tr, old) {
        const m = tr.getMeta(LinterKey) as Diagnostic[] | undefined;
        if (m && m.length > 0)
            Debug.info(m, 'oooo');
        return m ? lintDeco(tr.doc, m) : old;
    }
  },
  props: {
    decorations(state) { return this.getState(state) },
    handleDOMEvents: {
        "mouseover"(view, ev) {
            if (ev.target instanceof Element && /lint/.test(ev.target.className)) {
                const diags = getDiag(view, this, ev.target);
                const rect = ev.target.getBoundingClientRect();
                show(diags, rect);
            } else {
                // hide();
            }
        },
        "mouseleave"() {
            // hide();
        },
    }
  }
});
