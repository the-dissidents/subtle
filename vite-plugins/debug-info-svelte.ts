import { walk } from 'zimmerframe';
import type { Plugin } from 'vite';
import * as svc from 'svelte/compiler';
import MagicString from 'magic-string';

export default function debugInfoSvelte(): Plugin {
  return {
    name: 'debug-info-svelte',

    enforce: 'pre',

    async transform(code, id) {
      if (!/\.svelte$/.test(id)) {
        return null;
      }

      const ast = svc.parse(code, { filename: id, modern: true });
      const ms = new MagicString(code, { filename: id });
      
      function walkNode(n: svc.AST.SvelteNode) {
        walk(n, {funcNames: []}, {
          _(_node, { state, next }) {
            next({ ...state });
          },
          FunctionDeclaration(node, { state, next }) {
            const name = node.id?.name ?? '?';
            state.funcNames.push(name);
            next({ ...state });
            state.funcNames.pop();
          },
          CallExpression(node, { state }) {
            if (node.callee.type !== "MemberExpression"
             || node.callee.object.type !== "Identifier"
             || node.callee.object.name !== "Debug"
             || node.callee.property.type !== "Identifier") return;
            if (!node.loc) return;

            if (node.callee.property.name == 'assert') {
              if (node.arguments.length != 1) return;

              const pos = (node.arguments[0] as svc.AST.BaseNode).end;
              if (pos === undefined) return;

              ms.appendRight(pos, `, "${id ?? 'cannot get filename'}", ${node.loc.start.line.toString() ?? '"cannot get line"'}`);
            }

            if (node.callee.property.name == 'early') {
              if (node.arguments.length != 0) return;

              const pos = (node as unknown as svc.AST.BaseNode).end - 1;
              if (pos === undefined) return;

              ms.appendRight(pos, `"${state.funcNames.at(-1) ?? '?'}", "${id ?? 'cannot get filename'}", ${node.loc.start.line.toString() ?? '"cannot get line"'}`);
            }
          },
        });
      }
      
      if (ast.instance)
        walkNode(ast.instance.content);

      if (ast.module)
        walkNode(ast.module.content);

      walkNode(ast.fragment);

      return {
        code: ms.toString(),
        map: ms.generateMap(),
      };
    },
  };
}