import { Debug } from "../Debug";
import { Dialogs } from "./Dialogs";
import { Interface } from "./Interface";
import { bindingToString, type KeyBinding, type CommandBinding } from "./Keybinding";
import { Menu, type MenuItemOptions, type SubmenuOptions } from "@tauri-apps/api/menu";

export type CommandOptions<TState = any> = ({
    displayAccel?: string,
    isDialog?: boolean,
    call: () => (TState | Promise<TState>)
} | {
    menuName?: string | (() => string),
    items: CommandOptions<TState>[] | (() => CommandOptions<TState>[])
}) & {
    name: string | (() => string),
    isApplicable?: () => boolean,
    onDeactivate?: (state: TState) => (void | Promise<void>)
};

/** T should not be a function type */
function unwrap<T>(fv: T | (() => T)): T {
    // @ts-expect-error
    return typeof fv === 'function' ? fv() : fv;
}

function commandOptionToMenu(item: CommandOptions): MenuItemOptions | SubmenuOptions {
    const enabled = item.isApplicable ? item.isApplicable() : true;
    return 'call' in item ? {
        text: unwrap(item.name),
        enabled,
        accelerator: item.displayAccel,
        action: () => item.call()
    } : {
        text: unwrap(item.name),
        enabled,
        items: enabled ? [...item.menuName ? [{
            text: unwrap(item.menuName),
            enabled: false
        }] : [], ...unwrap(item.items).map((x) => commandOptionToMenu(x))] : []
    }
}

export type UICommandType = 'simple' | 'menu' | 'dialog';

export class UICommand<TState = void> {
    static #activated = new Map<UICommand<any>, KeyBinding | null>();
    static get activeCommands(): ReadonlyMap<UICommand<any>, KeyBinding | null> {
        return this.#activated;
    }

    public readonly defaultBindings: readonly CommandBinding[];
    
    #state: TState | undefined;

    get activated() {
        return UICommand.#activated.has(this);
    }

    constructor(
        public readonly category: () => string,
        public bindings: CommandBinding[], 
        private options: CommandOptions<TState>
    ) {
        this.defaultBindings = structuredClone(bindings);
    }

    get type(): UICommandType {
        return 'call' in this.options 
            ? (this.options.isDialog ? 'dialog' : 'simple')
            : 'menu' ;
    }

    get name() {
        return unwrap(this.options.name);
    }

    // FIXME: using command as menu item does not update its `activated` state
    toMenuItem(): SubmenuOptions {
        if ('call' in this.options) {
            const focus = Interface.getUIFocus();
            const b = this.bindings.find((x) => !x.contexts || x.contexts.has(focus));
            if (b && b.sequence.length == 1)
                this.options.displayAccel = bindingToString(b.sequence[0]);
        }
        return commandOptionToMenu(this.options);
    }

    async menu() {
        const enabled = this.options.isApplicable ? this.options.isApplicable() : true;
        if (!enabled) return;

        let opt = commandOptionToMenu(this.options);
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

    async #runCommand(item: CommandOptions) {
        const enabled = item.isApplicable ? item.isApplicable() : true;
        Debug.assert(enabled);
        if ('items' in item) {
            const items = unwrap(item.items);
            let n = await Dialogs.overlayMenu(
                items.map((x) => ({
                    text: unwrap(x.name),
                    disabled: x.isApplicable ? !x.isApplicable() : false
                })), 
                unwrap(item.name),
                unwrap(item.menuName ?? '')
            );
            if (n < 0) return;
            await this.#runCommand(items[n]);
        } else {
            this.#state = await item.call();
        }
    }

    async start(key: KeyBinding | null = null) {
        // don't start if already running
        if (this.activated) return false;

        const enabled = this.options.isApplicable ? this.options.isApplicable() : true;
        if (!enabled) return false;

        Debug.debug('executing command', this.name);
        UICommand.#activated.set(this, key);
        await this.#runCommand(this.options);
        // end immediately when there's no onDeactivate handler. this is for reducing the 
        // probability of accidentally leaving a command marked as activated for too long, 
        // e.g. in the case where the key is lifted only after the window lost focus
        if (!this.options.onDeactivate)
            UICommand.#activated.delete(this);
        return true;
    }

    async end() {
        Debug.assert(this.activated && this.#state !== undefined);
        if (this.options.onDeactivate) {
            Debug.debug('executing onDeactivate', this.name);
            await this.options.onDeactivate(this.#state);
        }
        UICommand.#activated.delete(this);
    }
};