import type { Node } from "prosemirror-model";
import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { Diagnostic } from "../../linter/Common";

function lintDeco(doc: Node, diags: Diagnostic[]) {
  const decos: Decoration[] = [];
  diags.forEach((x) => {
    decos.push(Decoration.inline(x.start, x.to, { class: "diag" }, { diag: x }))
  });
  return DecorationSet.create(doc, decos)
}

export const LinterKey = new PluginKey('Linter');

export const Linter = (initial: Diagnostic[] = []) => new Plugin({
  state: {
    init(_, {doc}) {
        return lintDeco(doc, initial);
    },
    apply(tr, old) {
        const m = tr.getMeta(LinterKey) as Diagnostic[] | undefined;
        return m ? lintDeco(tr.doc, m) : old;
    }
  },
  props: {
    decorations(state) { return this.getState(state) },
  }
});
