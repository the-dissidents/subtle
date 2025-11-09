export class BinaryReader<T extends ArrayBufferLike = ArrayBufferLike> {
    private data: DataView<T>;
    private i = 0;

    constructor(buf: T) {
        this.data = new DataView(buf);
    }

    /** current position in bytes */
    get pos() {
        return this.i;
    }

    readU32() {
        const result = this.data.getUint32(this.i, true);
        this.i += 4;
        return result;
    }

    readI32() {
        const result = this.data.getInt32(this.i, true);
        this.i += 4;
        return result;
    }

    readI64() {
        const result = this.data.getBigInt64(this.i, true);
        this.i += 8;
        return Number(result);
    }

    readF64() {
        const result = this.data.getFloat64(this.i, true);
        this.i += 8;
        return result;
    }

    readF32Array(length: number) {
        const content = new Float32Array(this.data.buffer, this.i, length);
        this.i += length * 4;
        return content;
    }

    readU8ClampedArray(length: number) {
        const content = new Uint8ClampedArray(this.data.buffer, this.i, length);
        this.i += length;
        return content;
    }
}