import { Basic } from "../Basic";
import { Debug } from "../Debug";
import { HashMap } from "../details/HashMap";
import { Interface } from "./Interface";
import { UIFocus } from "./Frontend";
import type { UICommand } from "./CommandBase";

import { _, unwrapFunctionStore } from 'svelte-i18n';
import { Dialogs } from "./Dialogs";
const $_ = unwrapFunctionStore(_);

export type KeyBinding = {
    key: KeyCode,
    modifiers: Set<ModifierKey>,
};

export type CommandBinding = {
    sequence: KeyBinding[],
    contexts?: Set<UIFocus>,
};

export const ModifierKeys = 
    ['CapsLock', 'Control', 'Alt', 'Shift', 'Meta'] as const;

export type ModifierKey = (typeof ModifierKeys)[number];

function shortcut(expr: string): KeyBinding {
    if (expr.includes('CmdOrCtrl'))
        expr = expr.replace('CmdOrCtrl', Basic.ctrlKey);
    const split = expr.split('+');
    Debug.assert(split.length >= 1);
    let key = split.pop()!;
    Debug.assert(isKeyCode(key));
    let modifiers = new Set<ModifierKey>();
    for (const mod of split) {
        Debug.assert(ModifierKeys.includes(mod as ModifierKey));
        modifiers.add(mod as ModifierKey);
    }
    return { key, modifiers };
}

export function bindingToString(binding: KeyBinding) {
    return [
        ...ModifierKeys.filter((x) => binding.modifiers.has(x)), 
        binding.key[0].toUpperCase() + binding.key.slice(1)
    ].join('+')
     .replace('Meta', 'Cmd')
     .replace(' ', 'Space');
}

export function binding(exprs: string[], ctxs?: UIFocus[]): CommandBinding {
    return {
        sequence: exprs.map(shortcut),
        contexts: ctxs?.length ? new Set(ctxs) : undefined
    }
}

// Written by Gemini-2.5-Pro-Exp
// Derived by cross-referencing KeyboardEvent.code values with the Tauri parser code
const codeMap = {
    // Alphanumeric keys (preferring single char)
    KeyA: 'A',
    KeyB: 'B',
    KeyC: 'C',
    KeyD: 'D',
    KeyE: 'E',
    KeyF: 'F',
    KeyG: 'G',
    KeyH: 'H',
    KeyI: 'I',
    KeyJ: 'J',
    KeyK: 'K',
    KeyL: 'L',
    KeyM: 'M',
    KeyN: 'N',
    KeyO: 'O',
    KeyP: 'P',
    KeyQ: 'Q',
    KeyR: 'R',
    KeyS: 'S',
    KeyT: 'T',
    KeyU: 'U',
    KeyV: 'V',
    KeyW: 'W',
    KeyX: 'X',
    KeyY: 'Y',
    KeyZ: 'Z',
    Digit0: '0',
    Digit1: '1',
    Digit2: '2',
    Digit3: '3',
    Digit4: '4',
    Digit5: '5',
    Digit6: '6',
    Digit7: '7',
    Digit8: '8',
    Digit9: '9',

    // Symbol keys (preferring single char)
    Backquote: '`',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',

    // Whitespace & Control keys
    Enter: 'Enter',
    Tab: 'Tab',
    Space: 'Space',
    Backspace: 'Backspace',
    Escape: 'Escape',

    // Navigation & Editing keys
    Delete: 'Delete', // Corresponds to ForwardDelete (kVK_ForwardDelete) on macOS
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    Insert: 'Insert', // kVK_Help maps to Insert in Chromium, Tauri supports Insert

    // Arrow keys (preferring short names)
    ArrowUp: 'ArrowUp',
    ArrowDown: 'ArrowDown',
    ArrowLeft: 'ArrowLeft',
    ArrowRight: 'ArrowRight',

    // Function keys
    F1: 'F1',
    F2: 'F2',
    F3: 'F3',
    F4: 'F4',
    F5: 'F5',
    F6: 'F6',
    F7: 'F7',
    F8: 'F8',
    F9: 'F9',
    F10: 'F10',
    F11: 'F11',
    F12: 'F12',
    F13: 'F13',
    F14: 'F14',
    F15: 'F15',
    F16: 'F16',
    F17: 'F17',
    F18: 'F18',
    F19: 'F19',
    F20: 'F20',
    F21: 'F21', // Assuming support based on pattern
    F22: 'F22', // Assuming support based on pattern
    F23: 'F23', // Assuming support based on pattern
    F24: 'F24', // Assuming support based on pattern

    // Numpad keys (preferring short names like NUM*)
    NumLock: 'NumLock', // Note: kVK_ANSI_KeypadClear maps to NumLock
    Numpad0: 'Num0',
    Numpad1: 'Num1',
    Numpad2: 'Num2',
    Numpad3: 'Num3',
    Numpad4: 'Num4',
    Numpad5: 'Num5',
    Numpad6: 'Num6',
    Numpad7: 'Num7',
    Numpad8: 'Num8',
    Numpad9: 'Num9',
    NumpadAdd: 'NumAdd', // Or NumPlus, NumAdd is shorter
    NumpadSubtract: 'NumSubtract',
    NumpadMultiply: 'NumMultiply',
    NumpadDivide: 'NumDivide',
    NumpadDecimal: 'NumDecimal',
    NumpadEnter: 'NumEnter',
    NumpadEqual: 'NumEqual',
    // NumpadComma: 'NumpadComma', // Present in JS codes, but not explicitly listed in Tauri parser? Check Tauri docs if needed. Assuming unsupported for now based only on provided Rust code.

    // Media keys (preferring shorter names)
    // Mapping both Firefox and Chromium variants where applicable
    VolumeDown: 'VolumeDown',
    AudioVolumeDown: 'VolumeDown',
    VolumeUp: 'VolumeUp',
    AudioVolumeUp: 'VolumeUp',
    VolumeMute: 'VolumeMute',
    AudioVolumeMute: 'VolumeMute',
    MediaPlayPause: 'MediaPlayPause',
    // MediaPlay: 'MediaPlay', // Explicitly listed in Tauri parser
    // MediaPause: 'MediaPause', // Explicitly listed in Tauri parser
    MediaStop: 'MediaStop',
    MediaTrackNext: 'MediaTrackNext',
    MediaTrackPrevious: 'MediaTrackPrev', // Shortest alias

    // Other keys supported by Tauri parser
    PrintScreen: 'PrintScreen',
    ScrollLock: 'ScrollLock',
    // ContextMenu: 'ContextMenu', // Present in JS codes, not in Tauri parser
} as const;

export type KeyCode = (typeof codeMap)[keyof typeof codeMap];
const keyCodeSet = new Set(Object.values(codeMap));

function isKeyCode(code: string): code is KeyCode {
    return keyCodeSet.has(code as any);
}

function translateCode(code: string): KeyCode | null {
    if (code in codeMap)
        return codeMap[code as keyof typeof codeMap];
    return null;
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
    type: 'incomplete' | 'disabled'
};

export const KeybindingManager = {
    commands: [] as UICommand[],

    async init() {
        this.update();
        document.addEventListener('keydown', (ev) => {
            const result = this.processKeydown(ev);
            switch (result.type) {
                case 'incomplete':
                case 'disabled': break;
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

    parseKey(ev: KeyboardEvent): KeyBinding | null {
        if (ModifierKeys.includes(ev.key as any))
            return null;
        let key = translateCode(ev.code);
        if (!key) return null;
        return {
            key,
            modifiers: new Set(ModifierKeys.filter((x) => ev.getModifierState(x)))
        };
    },

    processKeydown(ev: KeyboardEvent): AcceptKeyResult {
        if (Dialogs.modalOpenCounter > 0)
            return { type: 'disabled' }; // TODO: more sophisticated disabling?
        const key = this.parseKey(ev);
        if (!key) return { type: 'incomplete' };
        Debug.trace(key);
        currentSequence.push(key);

        const map = currentNode?.children ?? bindingTree;
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
        let conflicts: [UICommand, UIFocus[]][] = [];
        let current = bindingTree;
        let node: KeyTreeNode | undefined;
        for (const step of key.sequence) {
            node = current.get(step);
            if (!node) break;
            for (const other of node.values) {
                const any = !other.contexts && !key.contexts;
                const overlap = any ? [] 
                    : !other.contexts ? [...key.contexts!]
                    : !key.contexts ? [...other.contexts!]
                    : [...other.contexts!].filter((x) => key.contexts!.has(x));
                if ((any || overlap.length > 0) && other.command !== cmd)
                    conflicts.push([other.command, overlap]);
            }
            current = node.children;
        }
        return conflicts;
    }
}