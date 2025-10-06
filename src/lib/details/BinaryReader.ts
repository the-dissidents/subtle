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

    readF64() {
        const result = this.data.getFloat64(this.i, true);
        this.i += 8;
        return result;
    }
}