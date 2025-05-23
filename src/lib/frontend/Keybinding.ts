import { Basic } from "../Basic";
import { Debug } from "../Debug";
import { HashMap } from "../details/HashMap";
import { guardAsync, Interface } from "./Interface";
import { UIFocusList, type UIFocus } from "./Frontend";
import { UICommand } from "./CommandBase";

import { Dialogs } from "./Dialogs";
import type { JSONSchemaType } from "ajv/dist/core";
import Ajv from "ajv";
import * as fs from "@tauri-apps/plugin-fs";

import { _, unwrapFunctionStore } from 'svelte-i18n';
const $_ = unwrapFunctionStore(_);

export class KeyBinding {
    constructor(
        /** key code, as used by Tauri menus */
        public key: KeyCode,
        /** modifers, as used by `getModifierState` */
        public modifiers: Set<ModifierKey>,
    ) {}

    clone() {
        return new KeyBinding(this.key, new Set(this.modifiers));
    }

    toString(): string {
        return [
            ...ModifierKeys.filter((x) => this.modifiers.has(x)), 
            this.key[0].toUpperCase() + this.key.slice(1)
        ].join('+')
         .replace('Meta', 'Cmd')
         .replace(' ', 'Space');
    }
};

export class CommandBinding {
    constructor(
        public sequence: KeyBinding[],
        public contexts?: Set<UIFocus>
    ) {}

    static from(exprs: string[], ctxs?: UIFocus[]) {
        const sequence = exprs.map((expr) => {
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
            return new KeyBinding(key, modifiers);
        });
        const contexts = ctxs?.length ? new Set(ctxs) : undefined;
        return new CommandBinding(sequence, contexts);
    }

    clone() {
        return new CommandBinding(
            this.sequence.map((x) => x.clone()),
            this.contexts ? new Set(this.contexts) : undefined
        );
    }

    toSerializable(): KeybindingSerialization {
        return {
            sequence: this.sequence.map((y) => ({
                key: y.key,
                modifiers: [...y.modifiers].toSorted()
            })),
            contexts: this.contexts ? [...this.contexts].toSorted() : undefined
        };
    }
};

export const ModifierKeys = 
    ['CapsLock', 'Control', 'Alt', 'Shift', 'Meta'] as const;

export type ModifierKey = (typeof ModifierKeys)[number];

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
const keyCodeArray = [...keyCodeSet];

function isKeyCode(code: string): code is KeyCode {
    return keyCodeSet.has(code as any);
}

/** Convert DOM a key code (`KeyboardEvent.code`) into Tauri key code */
function fromDOM(code: string): KeyCode | null {
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

export type AcceptKeyDownResult = {
    type: 'notFound',
    sequence: KeyBinding[]
} | {
    type: 'activate',
    key: KeyBinding,
    command: UICommand
} | {
    type: 'waitNext',
    currentSequence: KeyBinding[]
} | {
    type: 'incomplete' | 'disabled'
};

export type AcceptKeyUpResult = {
    type: 'deactivate',
    commands: UICommand[]
} | {
    type: 'notFound'
};

type KeybindingSerialization = {
    sequence: {
        key: KeyCode,
        modifiers: ModifierKey[]
    }[],
    contexts?: UIFocus[]
}

type KeymapSerialization = Record<string, KeybindingSerialization[]>;

const KeybindingSchema: JSONSchemaType<KeymapSerialization> = {
    type: "object",
    additionalProperties: {
        type: "array",
        items: {
            type: "object",
            properties: {
                sequence: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            key: {
                                type: "string",
                                enum: keyCodeArray
                            },
                            modifiers: {
                                type: "array",
                                items: {
                                    type: "string",
                                    enum: ModifierKeys
                                },
                            }
                        },
                        required: ["key", "modifiers"]
                    }
                },
                contexts: {
                    type: "array",
                    items: {
                        type: "string",
                        enum: UIFocusList
                    },
                    uniqueItems: true,
                    nullable: true
                }
            },
            required: ["sequence"]
        }
    },
    required: []
};

const ajv = new Ajv();
const validate = ajv.compile(KeybindingSchema);
const ConfigFile = 'keybinding.json';

export const KeybindingManager = {
    commands: new Map<string, UICommand<any>>(),

    async init() {
        await this.read();
        this.update();
        document.addEventListener('keydown', (ev) => {
            const result = this.processKeydown(ev);
            switch (result.type) {
                case 'incomplete':
                case 'disabled': break;
                case "notFound":
                    if (result.sequence.length > 1) {
                        Interface.setStatus($_('msg.hotkey-not-found', 
                            { values: { key: 
                                result.sequence.map((x) => x.toString()).join(' ')
                            } }), 'error');
                    }
                    break;
                case "activate":
                    ev.preventDefault();
                    result.command.start(result.key);
                    break;
                case "waitNext":
                    ev.preventDefault();
                    Interface.setStatus($_('msg.waiting-for-chord-after-pressing', 
                        { values: { key: 
                            result.currentSequence.map((x) => x.toString()).join(' ')
                        } }));
                    break;
                default:
                    Debug.never(result);
            }
        });
        document.addEventListener('keyup', (ev) => {
            const result = this.processKeyUp(ev);
            switch (result.type) {
                case 'deactivate':
                    result.commands.forEach((x) => x.end());
                    break;
                case 'notFound':
                    break;
                default:
                    Debug.never(result);
            }
        });
    },

    async read() {
        if (!await fs.exists(ConfigFile, {baseDir: fs.BaseDirectory.AppConfig})) {
            await Debug.info('no keybinding config found');
            return;
        }
        let obj = JSON.parse(await fs.readTextFile(
            ConfigFile, {baseDir: fs.BaseDirectory.AppConfig}));
        if (!validate(obj)) {
            await Debug.info('invalid keybinding config:', validate.errors);
            return;
        }
        for (const name in obj) {
            let cmd = this.commands.get(name);
            if (!cmd) continue;
            cmd.bindings = obj[name].map((x) => new CommandBinding(
                x.sequence.map((y) => new KeyBinding(y.key, new Set(y.modifiers))),
                x.contexts ? new Set(x.contexts) : undefined
            ));
        }
        await Debug.debug('reading keybinding config');
    },

    async save() {
        await Basic.ensureConfigDirectoryExists();

        let serializable: KeymapSerialization = {};
        for (const [name, cmd] of this.commands)
            serializable[name] = cmd.bindings.map((x) => x.toSerializable());

        await guardAsync(async () => {
            await fs.writeTextFile(ConfigFile, 
                JSON.stringify(serializable, null, 2), {baseDir: fs.BaseDirectory.AppConfig}); 
            await Debug.info('saved keybinding')
        }, $_('msg.error-saving-keybinding'));
    },

    parseKey(ev: KeyboardEvent): KeyBinding | null {
        if (ModifierKeys.includes(ev.key as any))
            return null;
        let key = fromDOM(ev.code);
        if (!key) return null;
        return new KeyBinding(key, 
            new Set(ModifierKeys.filter((x) => ev.getModifierState(x))));
    },

    processKeydown(ev: KeyboardEvent): AcceptKeyDownResult {
        if (Dialogs.modalOpenCounter > 0)
            return { type: 'disabled' }; // TODO: more sophisticated disabling?
        const key = this.parseKey(ev);
        const focus = Interface.getUIFocus();
        if (!key) return { type: 'incomplete' };
        Debug.trace('key:', key, focus);
        currentSequence.push(key);

        const map = currentNode?.children ?? bindingTree;
        const seq = [...currentSequence];
        let node = map.get(key);
        if (node) {
            const cmd = node.values.find(
                (x) => !x.contexts || x.contexts.has(focus));
            if (cmd) {
                currentSequence = [];
                return {
                    type: 'activate',
                    key, command: cmd.command
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

    processKeyUp(ev: KeyboardEvent): AcceptKeyUpResult {
        const code = fromDOM(ev.code);
        const commands: UICommand[] = [];
        for (const [cmd, key] of UICommand.activeCommands) {
            if (!key) continue;
            if (key.key === code || key.modifiers.has(ev.key as ModifierKey))
                commands.push(cmd);
        }
        if (commands.length > 0) {
            return {
                type: 'deactivate',
                commands
            };
        } else return {
            type: 'notFound'
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
        for (const [_, cmd] of KeybindingManager.commands)
            for (const binding of cmd.bindings)
                registerBinding(binding, cmd);
    },

    findConflict(key: CommandBinding, cmd: UICommand<any>) {
        Debug.assert(bindingTree !== undefined);
        let conflicts: [UICommand<any>, UIFocus[]][] = [];
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
