import { transformAsync } from '@babel/core';
import { Plugin } from 'vite';
import { declare } from '@babel/helper-plugin-utils';
import * as t from '@babel/types';
import * as svc from 'svelte/compiler';

const plugin = declare(() => {
  return {
    name: 'subtle-debug-info',
    visitor: {
      CallExpression(path, state) {
        const node = path.node;
        
        if (node.callee.type !== "MemberExpression"
        || node.callee.object.type !== "Identifier"
        || node.callee.object.name !== "Debug"
        || node.callee.property.type !== "Identifier") return;

        if (node.callee.property.name == 'assert') {
          if (node.arguments.length != 1) return;
          if (!node.loc) return;
          
          node.arguments.push(
              t.stringLiteral(state.filename ?? 'cannot get filename'),
              t.stringLiteral(node.loc.start.line.toString() ?? 'cannot get line')
          );
        }

        if (node.callee.property.name == 'early') {
          if (node.arguments.length != 0) return;

          const func = path.getFunctionParent();
          if (!func) return;

          const pos = (node as unknown as svc.AST.BaseNode).end - 1;
          if (pos === undefined) return;

          let funcName: string;
          if ('key' in func.node) {
            if (func.node.key.type == 'PrivateName') {
              funcName = `#${func.node.key.id.name}`;
            }
            if (func.node.key.type == 'Identifier') {
              funcName = func.node.key.name;
            }
          } else if ('id' in func.node) {
            funcName = func.node.id?.name ?? '?';
          }

          node.arguments.push(
            t.stringLiteral(funcName),
            t.stringLiteral(state.filename ?? 'cannot get filename'),
            t.stringLiteral(node.loc.start.line.toString() ?? 'cannot get line')
          );
        }
      },
    },
  };
});

export default function debugInfoTS(): Plugin {
  return {
    name: 'debug-info-ts',

    enforce: 'pre',

    async transform(code, id) {
      if (!/\.ts$/.test(id)) {
        return null;
      }

      const result = await transformAsync(code, {
        filename: id,
        configFile: false, // Don't look for babel.config.js
        babelrc: false,    // Don't look for .babelrc
        
        parserOpts: {
          plugins: ['typescript'], // Add 'jsx' if you use .tsx
        },

        plugins: [plugin],
        presets: [],
      });

      if (!result) {
        return null;
      }
      
      return {
        code: result.code,
        map: result.map,
      };
    },
  };
}