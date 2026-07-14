import { untrack } from "svelte";

// For some reason Svelte no longer exports the type Snapshot<T>
// so we have to reproduce the code here.

// Copyright (c) 2016-2025 Svelte Contributors
// Licensed under the MIT License

type Primitive = string | number | bigint | boolean | null | undefined;

type TypedArray =
    | Int8Array
    | Uint8Array
    | Uint8ClampedArray
    | Int16Array
    | Uint16Array
    | Int32Array
    | Uint32Array
    | Float32Array
    | Float64Array
    | BigInt64Array
    | BigUint64Array;

/** The things that `structuredClone` can handle — https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm */
type Cloneable =
    | ArrayBuffer
    | DataView
    | Date
    | Error
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    | Map<any, any>
    | RegExp
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    | Set<any>
    | TypedArray
    // web APIs
    | Blob
    | CryptoKey
    | DOMException
    | DOMMatrix
    | DOMMatrixReadOnly
    | DOMPoint
    | DOMPointReadOnly
    | DOMQuad
    | DOMRect
    | DOMRectReadOnly
    | File
    | FileList
    | FileSystemDirectoryHandle
    | FileSystemFileHandle
    | FileSystemHandle
    | ImageBitmap
    | ImageData
    | RTCCertificate
    | VideoFrame;

/** Turn `SvelteDate`, `SvelteMap` and `SvelteSet` into their non-reactive counterparts. (`URL` is uncloneable.) */
type NonReactive<T> = T extends Date
    ? Date
    : T extends Map<infer K, infer V>
        ? Map<K, V>
        : T extends Set<infer K>
            ? Set<K>
            : T;

export type Snapshot<T> = T extends Primitive
    ? T
    : T extends Cloneable
        ? NonReactive<T>
        : T extends { toJSON(): infer R }
            ? R
            : T extends readonly unknown[]
                ? { [K in keyof T]: Snapshot<T[K]> }
                : T extends Array<infer U>
                    ? Array<Snapshot<U>>
                    : T extends object
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        ? T extends { [key: string]: any }
                            ? { [K in keyof T]: Snapshot<T[K]> }
                            : never
                        : never;

// end of copied code

export function hook<T>(track: () => T, action: (value: Snapshot<T>) => void) {
    $effect(() => {
        const value = $state.snapshot(track());
        untrack(() => action(value));
    });
}
