import type { JSONSchemaType } from "ajv";
import { Debug } from "../Debug";
import type { LabelType, SubtitleEntry, SubtitleStyle } from "./Subtitles.svelte"

import { ajv, DeserializationError, parseObject } from "../Serialization";
import wcwidth from "wcwidth";

import { _, unwrapFunctionStore } from 'svelte-i18n';
import { Basic } from "../Basic";
const $_ = unwrapFunctionStore(_);

import { Editing } from "../frontend/Editing";

export const MetricContextList = ['editing', 'entry', 'style', 'channel'] as const;
export type MetricContext = (typeof MetricContextList)[number];
export type MetricTypeName = 'string' | 'number' | 'style' | 'time' | 'label' | 'boolean';

export type MetricType<T> =
      T extends 'string' ? string
    : T extends 'number' ? number
    : T extends 'style' ? SubtitleStyle
    : T extends 'time' ? number
    : T extends 'label' ? LabelType
    : T extends 'boolean' ? boolean
    : never;

export class Metric<TypeName extends MetricTypeName> {
    public readonly integer: boolean;
    public readonly description?: () => string;
    constructor (
        public readonly type: TypeName,
        public readonly context: MetricContext,
        public readonly localizedName: () => string,
        public readonly shortName: () => string,
        public readonly value: 
            (entry: SubtitleEntry, style: SubtitleStyle) => MetricType<TypeName>,
        opts?: {
            description?: () => string,
            integer?: boolean
        }
    ) {
        // TODO: is this awkward? it only applies to numbers
        this.integer = opts?.integer ?? false;
        this.description = opts?.description;
    }

    stringValue(entry: SubtitleEntry, style: SubtitleStyle, digits = 3) {
        const value = this.value(entry, style);
        if (this.type == 'number') return (<number>value).toFixed(this.integer ? 0 : digits);
        if (this.type == 'string') return (<string>value);
        if (this.type == 'time') return Basic.formatTimestamp(<number>value);
        if (this.type == 'style') return (<SubtitleStyle>value).name;
        if (this.type == 'label') return $_('label.' + <LabelType>value);
        if (this.type == 'boolean') return $_('boolean.' + (<boolean>value).toString());
        Debug.never(this.type);
    }
};

export type MetricFilterMethod<
    FromType extends MetricTypeName, 
    ParameterType extends MetricTypeName,
    Arity extends number,
> = {
    fromType: FromType,
    localizedName: () => string,
    parameters: Arity,
} & (
    Arity extends 0 ? {
        parameterType?: ParameterType,
        exec(a: MetricType<FromType>): boolean
    } : Arity extends 1 ? {
        parameterType: ParameterType,
        exec(a: MetricType<FromType>, 
             b: MetricType<ParameterType>): boolean
    } : Arity extends 2 ? {
        parameterType: ParameterType,
        exec(a: MetricType<FromType>, 
             b: MetricType<ParameterType>,
             c: MetricType<ParameterType>): boolean
    } : never
);

function newFilterMethod<
    FromType extends MetricTypeName, 
    ParameterType extends MetricTypeName,
    Arity extends 0 | 1 | 2,
>(f: MetricFilterMethod<FromType, ParameterType, Arity>) { return f; }

export type SimpleMetricFilter<
    Metric extends MetricName = MetricName,
    Method extends MetricFilterMethodName = MetricFilterMethodName
> = {
    metric: Metric,
    method: Method,
    negated: boolean,
    parameters: 
          (typeof MetricFilterMethods)[Method]['parameters'] extends 0 ? []
        : (typeof MetricFilterMethods)[Method]['parameters'] extends 1 ? [_ParamType<Method>]
        : (typeof MetricFilterMethods)[Method]['parameters'] extends 2 ? [_ParamType<Method>, _ParamType<Method>]
        : never
};

export function newMetricFilter<
    Metric extends MetricName,
    Method extends MetricFilterMethodName
>(f: SimpleMetricFilter<Metric, Method>) { return f; }

export type MetricFilter = {
    type: 'and' | 'or',
    filters: (SimpleMetricFilter<MetricName, MetricFilterMethodName> | MetricFilter)[]
} | SimpleMetricFilter<MetricName, MetricFilterMethodName>;

export type EvaluateFilterResult = {
    failed: SimpleMetricFilter<MetricName, MetricFilterMethodName>[]
};

export function filterDescription(filter: SimpleMetricFilter) {
    return `${filter.negated ? $_('filter.description.not') : ''} ${
        Metrics[filter.metric].localizedName()} ${
        MetricFilterMethods[filter.method].localizedName()} ${
        (filter.parameters as (number[] | string[])).map((x) => x.toString()).join(' ')}`;
}

export function evaluateFilter(
    filter: MetricFilter,
    entry: SubtitleEntry, style: SubtitleStyle
): EvaluateFilterResult {
    if ('type' in filter) {
        const results = filter.filters.map((x) => evaluateFilter(x, entry, style).failed);
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
        const from = Metrics[filter.metric].value(entry, style);
        const success = MetricFilterMethods[filter.method]
            .exec(from as never, ...(filter.parameters as [never, any])) != filter.negated;
        return { failed: success ? [] : [filter] };
    }
}

function getTextLength(s: string) {
    return [...s.matchAll(/[\w\u4E00-\u9FFF]/g)].length;
}

export const Metrics = {
    selected: new Metric('boolean', 'editing',
        () => $_('metrics.selected'), 
        () => $_('metrics.selected'), 
        (e) => Editing.inSelection(e)),
    startTime: new Metric('time', 'entry',
        () => $_('metrics.start-time'), 
        () => $_('metrics.start-time-short'), 
        (e) => e.start),
    endTime: new Metric('time', 'entry',
        () => $_('metrics.end-time'), 
        () => $_('metrics.end-time-short'), 
        (e) => e.end),
    duration: new Metric('time', 'entry',
        () => $_('metrics.duration'), 
        () => $_('metrics.duration'), 
        (e) => e.end - e.start),
    label: new Metric('label', 'entry',
        () => $_('metrics.label'), 
        () => $_('metrics.label'), 
        (e) => e.label),
    style: new Metric('style', 'style',
        () => $_('metrics.style'), 
        () => $_('metrics.style'), 
        (e, s) => s),
    content: new Metric('string', 'channel',
        () => $_('metrics.content'), 
        () => $_('metrics.content'), 
        (e, s) => e.texts.get(s)!),
    lines: new Metric('number', 'channel',
        () => $_('metrics.number-of-lines'), 
        () => $_('metrics.number-of-lines-short'), 
        (e, s) => e.texts.get(s)!.split('\n').length,
        { integer: true }),
    chars: new Metric('number', 'channel',
        () => $_('metrics.number-of-characters'), 
        () => $_('metrics.number-of-characters-short'), 
        (e, s) => e.texts.get(s)!.length,
        { integer: true }),
    letters: new Metric('number', 'channel',
        () => $_('metrics.number-of-readable-characters'), 
        () => $_('metrics.number-of-readable-characters-short'), 
        (e, s) => getTextLength(e.texts.get(s)!),
        {
            integer: true,
            description: () => $_('metrics.readable-characters-d')
        }),
    charsInLongestLine: new Metric('number', 'channel',
        () => $_('metrics.number-of-characters-in-longest-line'), 
        () => $_('metrics.number-of-characters-in-longest-line-short'), 
        (e, s) => Math.max(0, ...e.texts.get(s)!.split('\n').map((x) => x.length)),
        { integer: true }),
    lettersInLongestLine: new Metric('number', 'channel',
        () => $_('metrics.number-of-letters-in-longest-line'), 
        () => $_('metrics.number-of-letters-in-longest-line-short'), 
        (e, s) => Math.max(0, ...e.texts.get(s)!.split('\n').map(getTextLength)),
        {
            integer: true,
            description: () => $_('metrics.readable-characters-d')
        }),
    widthOfLongestLine: new Metric('number', 'channel',
        () => $_('metrics.width-of-longest-line'), 
        () => $_('metrics.width-of-longest-line-short'), 
        (e, s) => Math.max(0, ...e.texts.get(s)!.split('\n').map(wcwidth)),
        {
            integer: true,
            description: () => $_('metrics.width-d')
        }),
    lettersPerSecond: new Metric('number', 'channel',
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
} as const;

export const MetricFilterMethods = {
    stringNonEmpty: newFilterMethod({
        localizedName: () => $_('filter.is-not-empty'),
        fromType: 'string',
        parameters: 0,
        exec: (a) => a.trim().length > 0,
    }),
    stringEqual: newFilterMethod({
        localizedName: () => $_('filter.equals'),
        fromType: 'string',
        parameterType: 'string',
        parameters: 1,
        exec: (a, b) => a == b,
    }),
    stringContains: newFilterMethod({
        localizedName: () => $_('filter.contains'),
        fromType: 'string',
        parameterType: 'string',
        parameters: 1,
        exec: (a, b) => a.includes(b),
    }),
    stringMatchesRegex: newFilterMethod({
        localizedName: () => $_('filter.matches-regex'),
        fromType: 'string',
        parameterType: 'string',
        parameters: 1,
        exec: (a, b) => new RegExp(b).test(a),
    }),
    numberEqual: newFilterMethod({
        localizedName: () => $_('filter.number-equals'),
        fromType: 'number',
        parameterType: 'number',
        parameters: 1,
        exec: (a, b) => a == b,
    }),
    numberGt: newFilterMethod({
        localizedName: () => $_('filter.greater-than'),
        fromType: 'number',
        parameterType: 'number',
        parameters: 1,
        exec: (a, b) => a > b,
    }),
    numberLt: newFilterMethod({
        localizedName: () => $_('filter.less-than'),
        fromType: 'number',
        parameterType: 'number',
        parameters: 1,
        exec: (a, b) => a < b,
    }),
    numberGeq: newFilterMethod({
        localizedName: () => $_('filter.greater-than-or-equal'),
        fromType: 'number',
        parameterType: 'number',
        parameters: 1,
        exec: (a, b) => a >= b,
    }),
    numberLeq: newFilterMethod({
        localizedName: () => $_('filter.less-than-or-equal'),
        fromType: 'number',
        parameterType: 'number',
        parameters: 1,
        exec: (a, b) => a <= b,
    }),
    numberBetweenInclusive: newFilterMethod({
        localizedName: () => $_('filter.between-inclusive'),
        fromType: 'number',
        parameterType: 'number',
        parameters: 2,
        exec: (a, b, c) => b <= a && a <= c,
    }),
    numberBetweenExclusive: newFilterMethod({
        localizedName: () => $_('filter.between-exclusive'),
        fromType: 'number',
        parameterType: 'number',
        parameters: 2,
        exec: (a, b, c) => b < a && a < c,
    }),
    timeEqual: newFilterMethod({
        localizedName: () => $_('filter.number-equals'),
        fromType: 'time',
        parameterType: 'time',
        parameters: 1,
        exec: (a, b) => a == b,
    }),
    timeGt: newFilterMethod({
        localizedName: () => $_('filter.greater-than'),
        fromType: 'time',
        parameterType: 'time',
        parameters: 1,
        exec: (a, b) => a > b,
    }),
    timeLt: newFilterMethod({
        localizedName: () => $_('filter.less-than'),
        fromType: 'time',
        parameterType: 'time',
        parameters: 1,
        exec: (a, b) => a < b,
    }),
    timeGeq: newFilterMethod({
        localizedName: () => $_('filter.greater-than-or-equal'),
        fromType: 'time',
        parameterType: 'time',
        parameters: 1,
        exec: (a, b) => a >= b,
    }),
    timeLeq: newFilterMethod({
        localizedName: () => $_('filter.less-than-or-equal'),
        fromType: 'time',
        parameterType: 'time',
        parameters: 1,
        exec: (a, b) => a <= b,
    }),
    timeBetweenInclusive: newFilterMethod({
        localizedName: () => $_('filter.between-inclusive'),
        fromType: 'time',
        parameterType: 'time',
        parameters: 2,
        exec: (a, b, c) => b <= a && a <= c,
    }),
    timeBetweenExclusive: newFilterMethod({
        localizedName: () => $_('filter.between-exclusive'),
        fromType: 'time',
        parameterType: 'time',
        parameters: 2,
        exec: (a, b, c) => b < a && a < c,
    }),
    styleEqual: newFilterMethod({
        localizedName: () => $_('filter.is'),
        fromType: 'style',
        parameterType: 'style',
        parameters: 1,
        exec: (a, b) => a.name == b.name,
    }),
    labelEqual: newFilterMethod({
        localizedName: () => $_('filter.is'),
        fromType: 'label',
        parameterType: 'label',
        parameters: 1,
        exec: (a, b) => a == b,
    }),
    isTrue: newFilterMethod({
        localizedName: () => $_('filter.is-true'),
        fromType: 'boolean',
        parameters: 0,
        exec: (a) => a,
    }),
} as const;

export const TextMetricFilterDefaultMethods: 
    {[key in MetricTypeName]: MetricFilterMethodName} = 
{
    string: 'stringNonEmpty',
    number: 'numberEqual',
    time: 'timeEqual',
    style: 'styleEqual',
    label: 'labelEqual',
    boolean: 'isTrue'
} as const;

export type MetricName = keyof typeof Metrics;
export type MetricFilterMethodName = keyof typeof MetricFilterMethods;

type _Arity<Name extends MetricFilterMethodName> = 
    (typeof MetricFilterMethods)[Name]['parameters'];

type _ParamType<Name extends MetricFilterMethodName> = 
    _Arity<Name> extends 0 
    ? unknown 
    : MetricType<(typeof MetricFilterMethods)[Name]['parameterType']>;

// serialization

const SimpleFilterSchema: JSONSchemaType<SimpleMetricFilter> = {
    type: 'object',
    properties: {
        metric: { enum: Object.keys(Metrics) } as any,
        method: { enum: Object.keys(MetricFilterMethods) } as any,
        negated: { type: 'boolean' },
        parameters: { type: "array", 
            anyOf: [
                { items: { type: "integer" } },
                { items: { type: "string" } }
            ]
        } as any
    },
    required: ['metric', 'method', 'parameters']
};

export const FilterSchema: JSONSchemaType<MetricFilter> = {
    '$id': 'filter',
    oneOf: [
        {
            type: 'object',
            properties: {
                type: { enum: ['and', 'or'] } as any,
                filters: {
                    type: 'array',
                    items: { '$ref': '#' } as any
                }
            },
            required: ['type', 'filters']
        },
        SimpleFilterSchema
    ]
};

const validateFilter = ajv.compile(FilterSchema);

function checkFilterInternal(
    filter: SimpleMetricFilter | MetricFilter
): void {
    if ('type' in filter) {
        filter.filters.forEach(checkFilterInternal);
    } else {
        const method = MetricFilterMethods[filter.method];
        const params = filter.parameters as any[];
        if (method.parameters == 0) {
            if (params.length > 0)
                throw new DeserializationError('0 parameters expected');
        } else {
            if (params.length != method.parameters)
                throw new DeserializationError(`${method.parameters} parameters expected`);
            if (typeof params[0] != method.parameterType)
                throw new DeserializationError(`${method.parameterType} parameters expected`);
        }
    }
}

export function deserializeFilter(filter: {}): MetricFilter {
    const obj = parseObject(filter, validateFilter);
    checkFilterInternal(obj);
    return obj;
}