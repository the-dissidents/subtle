import { Basic } from "../Basic";
import { Debug } from "../Debug";
import { HashMap } from "../details/HashMap";
import { guardAsync, Interface } from "./Interface";
import { UIFocusList, type UIFocus } from "./Frontend";
import { UICommand } from "./CommandBase";

import { Dialogs } from "./Dialogs";
import * as fs from "@tauri-apps/plugin-fs";

import { _, unwrapFunctionStore } from 'svelte-i18n';
import { KeyCodeMap, type KeyCode } from "../details/KeyCodeMap";
import * as z from "zod/v4-mini";
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

const keyCodeSet = new Set(Object.values(KeyCodeMap));
const keyCodeArray = [...keyCodeSet];

function isKeyCode(code: string): code is KeyCode {
    return keyCodeSet.has(code as any);
}

/** Convert DOM a key code (`KeyboardEvent.code`) into Tauri key code */
function fromDOM(code: string): KeyCode | null {
    if (code in KeyCodeMap)
        return KeyCodeMap[code as keyof typeof KeyCodeMap];
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

const ZKeybindingSerialization = z.object({
    sequence: z.array(z.object({
        key: z.enum(keyCodeArray as [KeyCode]),
        modifiers: z.array(z.enum(ModifierKeys))
    })),
    contexts: z.optional(z.array(z.enum(UIFocusList)))
});

const ZKeymap = z.record(z.string(), z.array(ZKeybindingSerialization));

type KeybindingSerialization = z.infer<typeof ZKeybindingSerialization>;
type KeymapSerialization = z.infer<typeof ZKeymap>;

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
        const result = ZKeymap.safeParse(obj);
        if (!result.success) {
            await Debug.info('invalid keybinding config:', result.error);
            return;
        }
        for (const name in result.data) {
            let cmd = this.commands.get(name);
            if (!cmd) continue;
            cmd.bindings = result.data[name].map((x) => new CommandBinding(
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
