import { Debug } from "../Debug";
import { overlayMenu } from "../ui/OverlayMenu.svelte";
import { Frontend } from "./Frontend";
import type { KeyBinding, CommandBinding } from "./Keybinding";
import { Menu, type MenuItemOptions, type SubmenuOptions } from "@tauri-apps/api/menu";

export type CommandOptions<TState = unknown> = ({
    displayAccel?: string,
    isDialog?: boolean,
    call: (self: UICommand<TState>) => (TState | Promise<TState>)
} | {
    menuName?: string | (() => string),
    emptyText?: string | (() => string),
    items: CommandOptions<TState>[] | (() => CommandOptions<TState>[]),
    rememberedItem?: string,
}) & {
    name: string | (() => string),
    isApplicable?: () => boolean,
    onDeactivate?: (state: TState) => (void | Promise<void>)
};

/** T should not be a function type */
function unwrap<T>(fv: T | (() => T)): T {
    // @ts-expect-error -- T should not be a function type
    return typeof fv === 'function' ? fv() : fv;
}

function commandOptionToMenu<T>(
    item: CommandOptions<T>, cmd: UICommand<T>,
    parents: CommandOptions<T>[]
): MenuItemOptions | SubmenuOptions {
    const enabled = item.isApplicable ? item.isApplicable() : true;
    return 'call' in item ? {
        text: unwrap(item.name),
        enabled,
        accelerator: item.displayAccel,
        action: () => {
            item.call(cmd);
            let name = unwrap(item.name);
            for (const p of parents.toReversed()) {
                Debug.assert('items' in p);
                p.rememberedItem = name;
                name = unwrap(p.name);
            }
        }
    } : {
        text: unwrap(item.name),
        enabled,
        items: enabled 
            ? [...item.menuName 
                ? [{ text: unwrap(item.menuName), enabled: false }] 
                : [], 
               ...unwrap(item.items)
                 .map((x) => commandOptionToMenu(x, cmd, [...parents, item]))] 
            : []
    }
}

export type UICommandType = 'simple' | 'menu' | 'dialog';

export class UICommand<TState = void> {
    static #activated = new Map<UICommand<unknown>, KeyBinding | null>();
    static get activeCommands(): ReadonlyMap<UICommand<unknown>, KeyBinding | null> {
        return this.#activated;
    }

    public readonly defaultBindings: readonly CommandBinding[];
    
    #state: { value: TState } | undefined;

    get activated() {
        return UICommand.#activated.has(this);
    }

    constructor(
        public readonly category: () => string,
        public bindings: CommandBinding[], 
        private options: CommandOptions<TState>
    ) {
        this.defaultBindings = bindings.map((x) => x.clone());
    }

    get type(): UICommandType {
        return 'call' in this.options 
            ? (this.options.isDialog ? 'dialog' : 'simple')
            : 'menu' ;
    }

    get name() {
        return unwrap(this.options.name);
    }

    get isApplicable() {
        return this.options.isApplicable?.() ?? true;
    }

    // FIXME: using command as menu item does not update its `activated` state
    toMenuItem(): SubmenuOptions {
        if ('call' in this.options) {
            const focus = Frontend.getUIFocus();
            const b = this.bindings.find((x) => !x.contexts || x.contexts.has(focus));
            if (b && b.sequence.length == 1)
                this.options.displayAccel = b.sequence[0].toString();
            // chord display is not supported
        }
        return commandOptionToMenu(this.options, this, []);
    }

    async menu() {
        if (!this.isApplicable)
            return Debug.early('command not applicable');

        const opt = commandOptionToMenu(this.options, this, []);
        if ('items' in opt) {
            await (await Menu.new(opt)).popup();
        } else {
            await this.call();
        }
    }

    async call() {
        if (await this.start() && this.activated)
            await this.end();
    }

    async #runCommand(item: CommandOptions<TState>) {
        if (!this.isApplicable)
            return Debug.early('command not applicable');
        if ('items' in item) {
            const items = unwrap(item.items);
            const n = await overlayMenu(
                items.map((x) => ({
                    text: unwrap(x.name),
                    disabled: x.isApplicable ? !x.isApplicable() : false
                })), 
                {
                    title: unwrap(item.name),
                    text: unwrap(item.menuName ?? ''),
                    emptyText: unwrap(item.emptyText ?? ''),
                    rememberedItem: item.rememberedItem
                }
            );
            if (n < 0) return;
            item.rememberedItem = unwrap(items[n].name);
            await this.#runCommand(items[n]);
        } else {
            this.#state = { value: await item.call(this) };
        }
    }

    async start(key: KeyBinding | null = null) {
        // don't start if already running
        if (this.activated)
            return Debug.early(`already running: ${this.name}`);
        if (!this.isApplicable) return false;

        Debug.debug('executing command', this.name);
        // @ts-expect-error -- converting to unknown
        UICommand.#activated.set(this, key);
        await this.#runCommand(this.options);
        // end immediately when there's no onDeactivate handler. this is for reducing the 
        // probability of accidentally leaving a command marked as activated for too long, 
        // e.g. in the case where the key is lifted only after the window lost focus
        if (!this.options.onDeactivate)
            // @ts-expect-error -- converting to unknown
            UICommand.#activated.delete(this);
        return true;
    }

    async end() {
        Debug.assert(this.activated);
        if (this.#state == undefined)
            return; // inside a selection dialog
        if (this.options.onDeactivate) {
            Debug.debug('executing onDeactivate', this.name);
            await this.options.onDeactivate(this.#state.value);
        }
        // @ts-expect-error -- converting to unknown
        UICommand.#activated.delete(this);
    }
};