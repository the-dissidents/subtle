console.info('core/Filter loading');

import { Debug } from "../Debug";
import { Basic } from "../Basic";
import { type SubtitleEntry, type Subtitles, type SubtitleStyle } from "./Subtitles.svelte"
import { LABEL_TYPES, type LabelType } from "./Labels";
import * as z from "zod/v4-mini";
import wcwidth from "wcwidth";

import { _, unwrapFunctionStore } from 'svelte-i18n';
import { DeserializationError } from "../Serialization";
const $_ = unwrapFunctionStore(_);

export const METRIC_CONTEXTS = ['editing', 'entry', 'style', 'channel'] as const;
export type MetricContext = (typeof METRIC_CONTEXTS)[number];

export const METRIC_TYPES = ['string', 'number', 'time', 'style', 'label', 'boolean'] as const;
export type MetricType = (typeof METRIC_TYPES)[number];

export type MetricValue<T> =
      T extends 'string' ? string
    : T extends 'number' ? number
    : T extends 'style' ? SubtitleStyle
    : T extends 'time' ? number
    : T extends 'label' ? LabelType
    : T extends 'boolean' ? boolean
    : never;

class MetricTypeDefinition<
    Name extends MetricType, 
    Serialized extends z.ZodMiniType
> {
    readonly clone: (value: MetricValue<Name>) => MetricValue<Name>;
    readonly isMonospace: boolean;

    constructor(
        readonly name: Name,
        readonly schema: Serialized,
        readonly serialize: (value: MetricValue<Name>) => z.infer<Serialized>,
        readonly deserialize: (value: z.infer<Serialized>, subs: Subtitles) => MetricValue<Name>,
        readonly toString: (value: MetricValue<Name>) => string,
        opts?: {
            clone?: (value: MetricValue<Name>) => MetricValue<Name>,
            monospace?: boolean
        }
    ) {
        this.clone = opts?.clone ?? ((x) => x);
        this.isMonospace = opts?.monospace ?? false;
    }
};

export const MetricTypeDefinitions = {
    string: new MetricTypeDefinition(
        "string", z.string(),
        (x) => x, (x) => x, (x) => x
    ),
    number: new MetricTypeDefinition(
        "number", z.number(),
        (x) => x, (x) => x, (x) => x.toFixed(3),
        { monospace: true }
    ),
    boolean: new MetricTypeDefinition(
        "boolean", z.boolean(),
        (x) => x, (x) => x, (x) => $_('boolean.' + x.toString())
    ),
    time: new MetricTypeDefinition(
        "time", z.number(),
        (x) => x, (x) => x, (x) => Basic.formatTimestamp(x),
        { monospace: true }
    ),
    label: new MetricTypeDefinition(
        "label", z.enum(LABEL_TYPES),
        (x) => x, (x) => x, (x) => $_('label.' + x)
    ),
    style: new MetricTypeDefinition(
        "style", z.string(),
        (x) => x.name, (name, subs) => {
            const result = subs.styles.find((x) => x.name == name);
            if (!result) throw new DeserializationError(`no such style: ${name}`);
            return result;
        },
        (x) => x.name
    ),
} satisfies {[k in MetricType]: MetricTypeDefinition<k, z.ZodMiniType>};

export class MetricDefinition<TypeName extends MetricType> {
    readonly integer: boolean;
    readonly description?: () => string;
    
    get type() {
        return MetricTypeDefinitions[this.typeName];
    }
    
    constructor (
        public readonly typeName: TypeName,
        public readonly context: MetricContext,
        public readonly localizedName: () => string,
        public readonly shortName: () => string,
        public readonly value: 
            (entry: SubtitleEntry, style: SubtitleStyle) => MetricValue<TypeName>,
        opts?: {
            description?: () => string,
            integer?: boolean
        }
    ) {
        // TODO: is this awkward? it only applies to numbers
        this.integer = opts?.integer ?? false;
        this.description = opts?.description;
    }

    stringValue(entry: SubtitleEntry, style: SubtitleStyle) {
        const value = this.value(entry, style);
        // very hacky special handling of integers
        if (this.typeName == 'number' && this.integer) {
            return (value as number).toString();
        }
        return MetricTypeDefinitions[this.typeName].toString(value as never);
    }
};

export class MetricFilterMethod<
    Subject extends MetricType = MetricType, 
    Params extends readonly MetricType[] = MetricType[]
> {
    constructor(
        readonly subject: Subject,
        readonly localizedName: () => string,
        readonly parameters: Params,
        readonly exec: (
            s: MetricValue<Subject>, 
            ...params: {[K in keyof Params]: MetricValue<Params[K]>}
        ) => boolean
    ) {}
}

function getTextLength(s: string) {
    return [...s.matchAll(/[\w\u4E00-\u9FFF]/g)].length;
}

export const Metrics: Record<string, MetricDefinition<MetricType>> = {
    startTime: new MetricDefinition('time', 'entry',
        () => $_('metrics.start-time'), 
        () => $_('metrics.start-time-short'), 
        (e) => e.start),
    endTime: new MetricDefinition('time', 'entry',
        () => $_('metrics.end-time'), 
        () => $_('metrics.end-time-short'), 
        (e) => e.end),
    duration: new MetricDefinition('time', 'entry',
        () => $_('metrics.duration'), 
        () => $_('metrics.duration'), 
        (e) => e.end - e.start),
    label: new MetricDefinition('label', 'entry',
        () => $_('metrics.label'), 
        () => $_('metrics.label'), 
        (e) => e.label),
    channels: new MetricDefinition('number', 'entry',
        () => $_('metrics.number-of-channels'), 
        () => $_('metrics.number-of-channels-short'), 
        (e) => e.texts.size, 
        { integer: true }),
    style: new MetricDefinition('style', 'style',
        () => $_('metrics.style'), 
        () => $_('metrics.style'), 
        (_e, s) => s),
    content: new MetricDefinition('string', 'channel',
        () => $_('metrics.content'), 
        () => $_('metrics.content'), 
        (e, s) => e.texts.get(s)!),
    lines: new MetricDefinition('number', 'channel',
        () => $_('metrics.number-of-lines'), 
        () => $_('metrics.number-of-lines-short'), 
        (e, s) => e.texts.get(s)!.split('\n').length,
        { integer: true }),
    chars: new MetricDefinition('number', 'channel',
        () => $_('metrics.number-of-characters'), 
        () => $_('metrics.number-of-characters-short'), 
        (e, s) => e.texts.get(s)!.length,
        { integer: true }),
    letters: new MetricDefinition('number', 'channel',
        () => $_('metrics.number-of-readable-characters'), 
        () => $_('metrics.number-of-readable-characters-short'), 
        (e, s) => getTextLength(e.texts.get(s)!),
        {
            integer: true,
            description: () => $_('metrics.readable-characters-d')
        }),
    charsInLongestLine: new MetricDefinition('number', 'channel',
        () => $_('metrics.number-of-characters-in-longest-line'), 
        () => $_('metrics.number-of-characters-in-longest-line-short'), 
        (e, s) => Math.max(0, ...e.texts.get(s)!.split('\n').map((x) => x.length)),
        { integer: true }),
    lettersInLongestLine: new MetricDefinition('number', 'channel',
        () => $_('metrics.number-of-letters-in-longest-line'), 
        () => $_('metrics.number-of-letters-in-longest-line-short'), 
        (e, s) => Math.max(0, ...e.texts.get(s)!.split('\n').map(getTextLength)),
        {
            integer: true,
            description: () => $_('metrics.readable-characters-d')
        }),
    widthOfLongestLine: new MetricDefinition('number', 'channel',
        () => $_('metrics.width-of-longest-line'), 
        () => $_('metrics.width-of-longest-line-short'), 
        (e, s) => Math.max(0, ...e.texts.get(s)!.split('\n').map(wcwidth)),
        {
            integer: true,
            description: () => $_('metrics.width-d')
        }),
    lettersPerSecond: new MetricDefinition('number', 'channel',
        () => $_('metrics.readable-characters-per-second'), 
        () => $_('metrics.readable-characters-per-second-short'), 
        (e, s) => {
            const value = getTextLength(e.texts.get(s)!) / (e.end - e.start);
            // TODO: is it ok to return 0 for NaN?
            return isNaN(value) ? 0 : value;
        },
        {
            description: () => $_('metrics.readable-characters-d')
        }),
};

export const MetricFilterMethods = {
    stringNonEmpty: new MetricFilterMethod(
        'string', () => $_('filter.is-not-empty'),
        [] as const,
        (a) => a.trim().length > 0,
    ),
    stringEqual: new MetricFilterMethod(
        'string', () => $_('filter.equals'),
        ['string'] as const,
        (a, b) => a == b,
    ),
    stringContains: new MetricFilterMethod(
        'string', () => $_('filter.contains'),
        ['string'] as const,
        (a, b) => a.includes(b),
    ),
    stringMatchesRegex: new MetricFilterMethod(
        'string', () => $_('filter.matches-regex'),
        ['string'] as const,
        (a, b) => new RegExp(b).test(a),
    ),
    numberEqual: new MetricFilterMethod(
        'number', () => $_('filter.number-equals'),
        ['number'] as const,
        (a, b) => a == b,
    ),
    numberGt: new MetricFilterMethod(
        'number', () => $_('filter.greater-than'),
        ['number'] as const,
        (a, b) => a > b,
    ),
    numberLt: new MetricFilterMethod(
        'number', () => $_('filter.less-than'),
        ['number'] as const,
        (a, b) => a < b,
    ),
    numberGeq: new MetricFilterMethod(
        'number', () => $_('filter.greater-than-or-equal'),
        ['number'] as const,
        (a, b) => a >= b,
    ),
    numberLeq: new MetricFilterMethod(
        'number', () => $_('filter.less-than-or-equal'),
        ['number'] as const,
        (a, b) => a <= b,
    ),
    numberBetweenInclusive: new MetricFilterMethod(
        'number', () => $_('filter.between-inclusive'),
        ['number', 'number'] as const,
        (a, b, c) => b <= a && a <= c,
    ),
    numberBetweenExclusive: new MetricFilterMethod(
        'number', () => $_('filter.between-exclusive'),
        ['number', 'number'] as const,
        (a, b, c) => b < a && a < c,
    ),
    timeEqual: new MetricFilterMethod(
        'time', () => $_('filter.number-equals'),
        ['time'] as const,
        (a, b) => a == b,
    ),
    timeGt: new MetricFilterMethod(
        'time', () => $_('filter.greater-than'),
        ['time'] as const,
        (a, b) => a > b,
    ),
    timeLt: new MetricFilterMethod(
        'time', () => $_('filter.less-than'),
        ['time'] as const,
        (a, b) => a < b,
    ),
    timeGeq: new MetricFilterMethod(
        'time', () => $_('filter.greater-than-or-equal'),
        ['time'] as const,
        (a, b) => a >= b,
    ),
    timeLeq: new MetricFilterMethod(
        'time', () => $_('filter.less-than-or-equal'),
        ['time'] as const,
        (a, b) => a <= b,
    ),
    timeBetweenInclusive: new MetricFilterMethod(
        'time', () => $_('filter.between-inclusive'),
        ['time', 'time'] as const,
        (a, b, c) => b <= a && a <= c,
    ),
    timeBetweenExclusive: new MetricFilterMethod(
        'time', () => $_('filter.between-exclusive'),
        ['time', 'time'] as const,
        (a, b, c) => b < a && a < c,
    ),
    styleEqual: new MetricFilterMethod(
        'style', () => $_('filter.is'),
        ['style'] as const,
        (a, b) => a.name == b.name,
    ),
    labelEqual: new MetricFilterMethod(
        'label', () => $_('filter.is'),
        ['label'] as const,
        (a, b) => a == b,
    ),
    isTrue: new MetricFilterMethod(
        'boolean', () => $_('filter.is-true'),
        [] as const,
        (a) => a,
    ),
} as const;

export const MetricFilterDefaultMethods: 
    {[key in MetricType]: MetricFilterMethodName} = 
{
    string: 'stringNonEmpty',
    number: 'numberEqual',
    time: 'timeEqual',
    style: 'styleEqual',
    label: 'labelEqual',
    boolean: 'isTrue'
} as const;

export type MetricFilterMethodName = keyof typeof MetricFilterMethods;

export type SimpleMetricFilter<
    Method extends MetricFilterMethodName = MetricFilterMethodName
> = {
    metric: string,
    method: Method,
    negated: boolean,
    parameters: {
        [K in keyof (typeof MetricFilterMethods)[Method]['parameters']]
            : MetricValue<(typeof MetricFilterMethods)[Method]['parameters'][K]>
    }
};

export function newMetricFilter<
    Method extends MetricFilterMethodName
>(f: SimpleMetricFilter<Method>) { return f; }

export type MetricFilter = {
    type: 'and' | 'or',
    filters: (SimpleMetricFilter<MetricFilterMethodName> | MetricFilter)[]
} | SimpleMetricFilter<MetricFilterMethodName>;

export type EvaluateFilterResult = {
    failed: SimpleMetricFilter<MetricFilterMethodName>[]
};

export const Filter = {
    evaluate(
        filter: MetricFilter, entry: SubtitleEntry, style: SubtitleStyle
    ): EvaluateFilterResult {
        if ('type' in filter) {
            const results = filter.filters.map(
                (x) => Filter.evaluate(x, entry, style).failed);
            switch (filter.type) {
                case "and":
                    return { failed: results.flat() };
                case "or":
                    return results.some((x) => x.length == 0) 
                        ? { failed: [] }
                        : { failed: results.flat() };
                default:
                    Debug.never(filter.type);
            }
        } else {
            const from = Metrics[filter.metric as keyof typeof Metrics].value(entry, style);
            const success = MetricFilterMethods[filter.method]
                .exec(from as never, ...(filter.parameters as unknown as never[])) != filter.negated;
            return { failed: success ? [] : [filter] };
        }
    },

    describe(filter: SimpleMetricFilter) {
        const not = filter.negated ? $_('filter.description.not') : '';
        const name = Metrics[filter.metric as keyof typeof Metrics].localizedName();
        const method = MetricFilterMethods[filter.method].localizedName();
        const params = (filter.parameters as unknown as never[]).map((x, i) => {
            const type = MetricFilterMethods[filter.method].parameters[i];
            return MetricTypeDefinitions[type].toString(x);
        });
        return `${not} ${name} ${method} ${params.join(' ')}`;
    },

    clone(f: MetricFilter): MetricFilter {
        if ('type' in f) {
            return {
                type: f.type,
                filters: f.filters.map((x) => Filter.clone(x))
            };
        } else {
            const parameters = (f.parameters as unknown as never[]).map((x, i) => {
                const type = MetricFilterMethods[f.method].parameters[i];
                return MetricTypeDefinitions[type].clone(x);
            }) as never;
            return {
                metric: f.metric,
                method: f.method,
                negated: f.negated,
                parameters
            }
        }
    },

    serialize(f: MetricFilter): z.infer<typeof ZFilterBase> {
        if ('type' in f) {
            return {
                type: f.type,
                filters: f.filters.map((x) => Filter.serialize(x))
            };
        } else {
            const parameters = (f.parameters as unknown as never[]).map((x, i) => {
                const type = MetricFilterMethods[f.method].parameters[i];
                return MetricTypeDefinitions[type].serialize(x);
            });
            return {
                metric: f.metric,
                method: f.method,
                negated: f.negated,
                parameters
            }
        }
    },

    deserialize(obj: unknown, subs: Subtitles): MetricFilter {
        const result = z.safeParse(ZFilterBase, obj);
        if (!result.success)
            throw new DeserializationError('parsing filter: ' + z.prettifyError(result.error));
        
        function d(f: z.infer<typeof ZFilterBase>): MetricFilter {
            if ('type' in f) {
                return {
                    type: f.type,
                    filters: f.filters.map((x) => d(x))
                };
            } else {
                const parameters = (f.parameters as unknown as never[]).map((x, i) => {
                    const type = MetricFilterMethods[f.method].parameters[i];
                    return MetricTypeDefinitions[type].deserialize(x, subs);
                }) as never;
                return {
                    metric: f.metric,
                    method: f.method,
                    negated: f.negated,
                    parameters
                }
            }
        }
        return d(result.data);
    }
}

// serialization

const ZSimpleFilter = z.object({
    metric: z.string().check(z.refine((x) => x in Metrics)),
    method: z.enum(Object.keys(MetricFilterMethods) as [MetricFilterMethodName]),
    negated: z._default(z.boolean(), false),
    parameters: z.array(z.unknown())
}).check(({issues, value: x}) => {
    const m = Metrics[x.metric as keyof typeof Metrics];
    const method = MetricFilterMethods[x.method];
    if (method.subject != m.typeName) issues.push({ 
        code: 'custom', input: x,
        message: 'method type mismatch',
        continue: true
    });
    if (x.parameters.length != method.parameters.length) issues.push({ 
        code: 'custom', input: x.parameters,
        message: `${method.parameters.length} parameters expected`,
        continue: true
    });
});

const ZFilterBase = z.union([
    z.object({
        type: z.enum(['and', 'or']),
        get filters(): z.core.$ZodArray<typeof ZFilterBase> {
            return z.array(ZFilterBase);
        }
    }),
    ZSimpleFilter, 
]);