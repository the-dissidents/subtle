export class Overridable<T> {
    setting = $state() as T;
    override = $state<T | null>(null);
    readonly value = $derived.by(() => this.override ?? this.setting);

    constructor(initial: T) {
        this.setting = initial;
    }
}