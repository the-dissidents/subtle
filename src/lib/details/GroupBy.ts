export type GroupedBy<Obj extends {[k in Key]: string}, Key extends keyof Obj> = 
    {[V in Obj[Key]]: OneGroup<Obj, Key, V>};

export type OneGroup<
    Obj extends {[k in Key]: string}, 
    Key extends keyof Obj, 
    Value extends Obj[Key]
// > = Omit<Extract<Obj, {[k2 in Key]: Value}>, Key>[];
> = Extract<Obj, {[k2 in Key]: Value}>[];

export function groupBy<Obj extends {[k in Key]: string}, Key extends keyof Obj>(
    objs: readonly Obj[], key: Key
): GroupedBy<Obj, Key> {
    const result: Record<string, Obj[]> = {};
    for (const obj of objs) {
        const type = obj[key];
        if (type in result)
            result[type].push(obj);
        else
            result[type] = [obj];
    }
    return result as GroupedBy<Obj, Key>;
}