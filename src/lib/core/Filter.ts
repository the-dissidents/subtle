import type { JSONSchemaType } from "ajv";
import { Debug } from "../Debug";
import type { SubtitleEntry, SubtitleStyle } from "./Subtitles.svelte"

import { _, unwrapFunctionStore } from 'svelte-i18n';
import { ajv, DeserializationError, parseObject } from "../Serialization";
const $_ = unwrapFunctionStore(_);

export type TextMetricTypeName = 'string' | 'number';

export type TextMetricType<T> =
      T extends 'string' ? string
    : T extends 'number' ? number
    : never;

export class TextMetric<TypeName extends TextMetricTypeName> {
    constructor (
        public readonly type: TypeName,
        public readonly localizedName: () => string,
        public readonly shortName: () => string,
        public readonly value: 
            (entry: SubtitleEntry, style: SubtitleStyle) => TextMetricType<TypeName>
    ) {}
};

export type MetricFilterMethod<
    FromType extends TextMetricTypeName, 
    ParameterType extends TextMetricTypeName,
    Arity extends number,
> = {
    fromType: FromType,
    localizedName: () => string,
    parameters: Arity,
} & (
    Arity extends 0 ? {
        parameterType?: ParameterType,
        exec(a: TextMetricType<FromType>): boolean
    } : Arity extends 1 ? {
        parameterType: ParameterType,
        exec(a: TextMetricType<FromType>, 
             b: TextMetricType<ParameterType>): boolean
    } : Arity extends 2 ? {
        parameterType: ParameterType,
        exec(a: TextMetricType<FromType>, 
             b: TextMetricType<ParameterType>,
             c: TextMetricType<ParameterType>): boolean
    } : never
);

function newFilterMethod<
    FromType extends TextMetricTypeName, 
    ParameterType extends TextMetricTypeName,
    Arity extends 0 | 1 | 2,
>(f: MetricFilterMethod<FromType, ParameterType, Arity>) { return f; }

export type MetricFilter<
    Metric extends TextMetricName = TextMetricName,
    Method extends TextMetricFilterMethodName = TextMetricFilterMethodName
> = {
    metric: Metric,
    method: Method,
    negated: boolean,
    parameters: 
          (typeof TextMetricFilterMethods)[Method]['parameters'] extends 0 ? []
        : (typeof TextMetricFilterMethods)[Method]['parameters'] extends 1 ? [_ParamType<Method>]
        : (typeof TextMetricFilterMethods)[Method]['parameters'] extends 2 ? [_ParamType<Method>, _ParamType<Method>]
        : never
};

export function newMetricFilter<
    Metric extends TextMetricName,
    Method extends TextMetricFilterMethodName
>(f: MetricFilter<Metric, Method>) { return f; }

export type MetricFilterCombination = {
    type: 'and' | 'or',
    filters: (MetricFilter<TextMetricName, TextMetricFilterMethodName> | MetricFilterCombination)[]
} | MetricFilter<TextMetricName, TextMetricFilterMethodName>;

export type EvaluateFilterResult = {
    failed: MetricFilter<TextMetricName, TextMetricFilterMethodName>[]
};

export function evaluateFilter(
    filter: MetricFilterCombination,
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
        const from = TextMetrics[filter.metric].value(entry, style);
        return TextMetricFilterMethods[filter.method]
            .exec(from as never, ...(filter.parameters as [never, any]))
                ? { failed: [] }
                : { failed: [filter] };
    }
}

function getTextLength(s: string) {
    return [...s.matchAll(/[\w\u4E00-\u9FFF]/g)].length;
}

export const TextMetrics = {
    content: new TextMetric('string', 
        () => $_('metrics.content'), 
        () => $_('metrics.content'), 
        (e, s) => e.texts.get(s)!),
    lines: new TextMetric('number', 
        () => $_('metrics.number-of-lines'), 
        () => $_('metrics.number-of-lines-short'), 
        (e, s) => e.texts.get(s)!.split('\n').length),
    chars: new TextMetric('number', 
        () => $_('metrics.number-of-characters'), 
        () => $_('metrics.number-of-characters-short'), 
        (e, s) => e.texts.get(s)!.length),
    charsInLongestLine: new TextMetric('number', 
        () => $_('metrics.number-of-characters-in-longest-line'), 
        () => $_('metrics.number-of-characters-in-longest-line-short'), 
        (e, s) => Math.max(0, ...e.texts.get(s)!.split('\n').map((x) => x.length))),
    charsPerSecond: new TextMetric('number', 
        () => $_('metrics.readable-characters-per-second'), 
        () => $_('metrics.readable-characters-per-second-short'), 
        (e, s) => {
            const value = getTextLength(e.texts.get(s)!) / (e.end - e.start);
            // TODO: is it ok to return 0 for NaN?
            return isNaN(value) ? 0 : value;
        }),
} as const;

export const TextMetricFilterMethods = {
    stringNull: newFilterMethod({
        localizedName: () => '',
        fromType: 'string',
        parameters: 0,
        exec: (a) => true,
    }),
    numberNull: newFilterMethod({
        localizedName: () => '',
        fromType: 'number',
        parameters: 0,
        exec: (a) => true,
    }),
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
} as const;

export const TextMetricFilterNullMethods = {
    string: 'stringNull',
    number: 'numberNull',
} as const;

export type TextMetricName = keyof typeof TextMetrics;
export type TextMetricFilterMethodName = keyof typeof TextMetricFilterMethods;

type _Arity<Name extends TextMetricFilterMethodName> = 
    (typeof TextMetricFilterMethods)[Name]['parameters'];

type _ParamType<Name extends TextMetricFilterMethodName> = 
    _Arity<Name> extends 0 
    ? unknown 
    : TextMetricType<(typeof TextMetricFilterMethods)[Name]['parameterType']>;

// serialization

const FilterSchema: JSONSchemaType<MetricFilter> = {
    type: 'object',
    properties: {
        metric: { enum: Object.keys(TextMetrics) } as any,
        method: { enum: Object.keys(TextMetricFilterMethods) } as any,
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

const FilterCombinationSchema: JSONSchemaType<MetricFilter | MetricFilterCombination> = {
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
        FilterSchema
    ]
};

const validateFilter = ajv.compile(FilterCombinationSchema);

function checkFilterInternal(
    filter: MetricFilter | MetricFilterCombination
): void {
    if ('type' in filter) {
        filter.filters.forEach(checkFilterInternal);
    } else {
        const method = TextMetricFilterMethods[filter.method];
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

export function deserializeFilter(filter: {}): MetricFilterCombination {
    const obj = parseObject(filter, validateFilter);
    checkFilterInternal(obj);
    return obj;
}