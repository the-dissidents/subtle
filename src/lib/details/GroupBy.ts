export type GroupedBy<Obj extends {[k in Key]: string}, Key extends keyof Obj> = 
    {[k in Obj[Key]]: Omit<Extract<Obj, {[k2 in Key]: k}>, Key>[]};

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
    return result as any;
}