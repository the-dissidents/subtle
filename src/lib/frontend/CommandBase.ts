import { Debug } from "../Debug";
import { Dialogs } from "./Dialogs";
import { Interface } from "./Interface";
import { bindingToString, type CommandBinding } from "./Keybinding";
import { Menu, type MenuItemOptions, type SubmenuOptions } from "@tauri-apps/api/menu";

export type CommandOptions = {
    name: string | (() => string),
    displayAccel?: string,
    isApplicable?: () => boolean,
    isDialog?: boolean,
    call: () => (void | Promise<void>)
} | {
    name: string | (() => string),
    menuName?: string | (() => string),
    isApplicable?: () => boolean,
    items: CommandOptions[] | (() => CommandOptions[])
};

/** T should not be a function type */
function unwrap<T>(fv: T | (() => T)): T {
    // @ts-expect-error
    return typeof fv === 'function' ? fv() : fv;
}

async function commandOptionCall(item: CommandOptions) {
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
        await commandOptionCall(items[n]);
    } else {
        await item.call();
    }
}

function commandOptionToMenu(item: CommandOptions): MenuItemOptions | SubmenuOptions {
    const enabled = item.isApplicable ? item.isApplicable() : true;
    return 'call' in item ? {
        text: unwrap(item.name),
        enabled,
        accelerator: item.displayAccel,
        action: item.call
    } : {
        text: unwrap(item.name),
        enabled,
        items: enabled ? [...item.menuName ? [{
            text: unwrap(item.menuName),
            enabled: false
        }] : [], ...unwrap(item.items).map(commandOptionToMenu)] : []
    }
}

export type UICommandType = 'simple' | 'menu' | 'dialog';

export class UICommand {
    public readonly defaultBindings: readonly CommandBinding[];

    constructor(
        public bindings: CommandBinding[], 
        private options: CommandOptions
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
        const enabled = this.options.isApplicable ? this.options.isApplicable() : true;
        if (!enabled) return;
        await commandOptionCall(this.options);
    }
};