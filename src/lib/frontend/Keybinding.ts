import { Basic } from "../Basic";
import { Debug } from "../Debug";
import { HashMap } from "../details/HashMap";
import { Interface } from "./Interface";
import { UIFocus } from "./Frontend";
import type { UICommand } from "./CommandBase";

import { _, unwrapFunctionStore } from 'svelte-i18n';
const $_ = unwrapFunctionStore(_);

export type KeyBinding = {
    key: string,
    modifiers: Set<ModifierKey>,
};

export type CommandBinding = {
    sequence: KeyBinding[],
    contexts?: Set<UIFocus>,
};

export const ModifierKeys = 
    ['CapsLock', 'Control', 'Fn', 'Alt', 'AltGraph', 'Shift', 'Meta'] as const;

export type ModifierKey = (typeof ModifierKeys)[number];

function shortcut(expr: string): KeyBinding {
    if (expr.includes('CmdOrCtrl'))
        expr = expr.replace('CmdOrCtrl', Basic.ctrlKey);
    const split = expr.split('+');
    Debug.assert(split.length >= 1);
    let key = split.pop()!;
    let modifiers = new Set<ModifierKey>();
    for (const mod of split) {
        Debug.assert(ModifierKeys.includes(mod as ModifierKey));
        modifiers.add(mod as ModifierKey);
    }
    return { key, modifiers };
}

export function bindingToString(binding: KeyBinding) {
    return [...ModifierKeys.filter((x) => binding.modifiers.has(x)), binding.key].join('+')
        .replace('Meta', 'Cmd')
        .replace(' ', 'Space');
}

export function binding(exprs: string[], ctxs?: UIFocus[]): CommandBinding {
    return {
        sequence: exprs.map(shortcut),
        contexts: ctxs?.length ? new Set(ctxs) : undefined
    }
}

const KeyTree = HashMap.build<KeyBinding>(
    (x) => `${[...x.modifiers.entries()].sort().join('-')}-${x.key.toUpperCase()}`)<KeyTreeNode>;

type KeyTree = HashMap<KeyBinding, KeyTreeNode>;

type KeyTreeNode = {
    children: KeyTree,
    allContexts: Set<UIFocus> | undefined,
    values: {
        contexts?: Set<UIFocus>,
        command: UICommand,
    }[],
};

let currentSequence: KeyBinding[] = [];
let currentNode: KeyTreeNode | undefined;
let bindingTree = new KeyTree([]);

export type AcceptKeyResult = {
    type: 'notFound',
    sequence: KeyBinding[]
} | {
    type: 'ok',
    command: UICommand
} | {
    type: 'waitNext',
    currentSequence: KeyBinding[]
} | {
    type: 'incomplete'
};

export const KeybindingManager = {
    commands: [] as UICommand[],

    async init() {
        this.update();
        document.addEventListener('keydown', 
            (ev) => {
                const result = this.processKeydown(ev);
                switch (result.type) {
                    case 'incomplete': break;
                    case "notFound":
                        if (result.sequence.length > 1) {
                            Interface.status.set($_('msg.hotkey-not-found', 
                                { values: { key: 
                                    result.sequence.map(bindingToString).join(' ')
                                } }));
                        }
                        break;
                    case "ok":
                        ev.preventDefault();
                        result.command.call();
                        break;
                    case "waitNext":
                        ev.preventDefault();
                        Interface.status.set($_('msg.waiting-for-chord-after-pressing', 
                            { values: { key: 
                                result.currentSequence.map(bindingToString).join(' ')
                            } }));
                        break;
                    default:
                        Debug.never(result);
                }
            });
    },

    async save() {

    },

    processKeydown(ev: KeyboardEvent): AcceptKeyResult {
        if (ModifierKeys.includes(ev.key as any))
            return { type: 'incomplete' };
        const map = currentNode?.children ?? bindingTree;
        const key: KeyBinding = {
            key: ev.key,
            modifiers: new Set(ModifierKeys.filter((x) => ev.getModifierState(x)))
        };
        Debug.debug(key);
        currentSequence.push(key);
        const seq = [...currentSequence];

        let node = map.get(key);
        if (node) {
            const focus = Interface.getUIFocus();
            const cmd = node.values.find(
                (x) => !x.contexts || x.contexts.has(focus));
            if (cmd) {
                currentSequence = [];
                return {
                    type: 'ok',
                    command: cmd.command
                };
            }
            if (node.children.size > 0 
            && (!node.allContexts || node.allContexts.has(focus)))
            {
                return {
                    type: 'waitNext',
                    currentSequence: seq
                };
            }
        }
        currentSequence = [];
        return {
            type: 'notFound',
            sequence: seq
        };
    },

    update() {
        function registerBinding(key: CommandBinding, cmd: UICommand) {
            Debug.assert(bindingTree !== undefined);
            let current = bindingTree;
            let node: KeyTreeNode | undefined;
            for (const step of key.sequence) {
                node = current.get(step);
                if (!node) {
                    node = {
                        children: new KeyTree(),
                        allContexts: new Set(),
                        values: []
                    };
                    current.set(step, node);
                }
                if (!key.contexts)
                    node.allContexts = undefined;
                else if (node.allContexts)
                    key.contexts.forEach((x) => node!.allContexts!.add(x));
                current = node.children;
            }
            Debug.assert(node !== undefined);
            node.values.push({
                contexts: key.contexts,
                command: cmd
            });
        }
    
        bindingTree = new KeyTree();
        for (const cmd of KeybindingManager.commands)
            for (const binding of cmd.bindings)
                registerBinding(binding, cmd);
    },

    findConflict(key: CommandBinding, cmd: UICommand) {
        Debug.assert(bindingTree !== undefined);
        let conflicts: UICommand[] = [];
        let current = bindingTree;
        let node: KeyTreeNode | undefined;
        for (const step of key.sequence) {
            node = current.get(step);
            if (!node) break;
            for (const other of node.values) {
                if (!other.contexts || !key.contexts 
                 || other.command !== cmd
                 || [...other.contexts].some((x) => key.contexts?.has(x)))
                {
                    conflicts.push(other.command);
                }
            }
            current = node.children;
        }
        return conflicts;
    }
}