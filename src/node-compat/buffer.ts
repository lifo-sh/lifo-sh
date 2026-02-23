const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class Buffer extends Uint8Array {
  // Use overloaded signatures to satisfy Uint8Array's static from
  static from(value: string | Uint8Array | number[] | ArrayBuffer | ArrayLike<number> | Iterable<number>, encodingOrMapFn?: string | ((v: number, k: number) => number), _thisArg?: unknown): Buffer {
    if (typeof value === 'string') {
      const encoding = encodingOrMapFn as string | undefined;
      if (encoding === 'base64') {
        const binary = atob(value);
        const buf = new Buffer(binary.length);
        for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
        return buf;
      }
      if (encoding === 'hex') {
        const buf = new Buffer(value.length / 2);
        for (let i = 0; i < value.length; i += 2) {
          buf[i / 2] = parseInt(value.substring(i, i + 2), 16);
        }
        return buf;
      }
      // utf-8 default
      const bytes = encoder.encode(value);
      const buf = new Buffer(bytes.length);
      buf.set(bytes);
      return buf;
    }
    if (value instanceof ArrayBuffer) {
      const buf = new Buffer(value.byteLength);
      buf.set(new Uint8Array(value));
      return buf;
    }
    if (value instanceof Uint8Array) {
      const buf = new Buffer(value.length);
      buf.set(value);
      return buf;
    }
    // ArrayLike<number> or number[]
    const arr = value as ArrayLike<number>;
    const buf = new Buffer(arr.length);
    for (let i = 0; i < arr.length; i++) buf[i] = arr[i];
    return buf;
  }

  static alloc(size: number, fill?: number): Buffer {
    const buf = new Buffer(size);
    if (fill !== undefined) buf.fill(fill);
    return buf;
  }

  static isBuffer(obj: unknown): obj is Buffer {
    return obj instanceof Buffer;
  }

  static concat(list: (Uint8Array | Buffer)[], totalLength?: number): Buffer {
    const len = totalLength ?? list.reduce((sum, b) => sum + b.length, 0);
    const result = Buffer.alloc(len);
    let offset = 0;
    for (const buf of list) {
      const slice = buf.subarray(0, Math.min(buf.length, len - offset));
      result.set(slice, offset);
      offset += slice.length;
      if (offset >= len) break;
    }
    return result;
  }

  toString(encoding?: string): string {
    if (encoding === 'base64') {
      let binary = '';
      for (let i = 0; i < this.length; i++) binary += String.fromCharCode(this[i]);
      return btoa(binary);
    }
    if (encoding === 'hex') {
      let hex = '';
      for (let i = 0; i < this.length; i++) hex += this[i].toString(16).padStart(2, '0');
      return hex;
    }
    // utf-8 default
    return decoder.decode(this);
  }

  write(str: string, offset?: number, length?: number, _encoding?: string): number {
    const bytes = encoder.encode(str);
    const start = offset ?? 0;
    const maxLen = length ?? this.length - start;
    const toWrite = Math.min(bytes.length, maxLen);
    this.set(bytes.subarray(0, toWrite), start);
    return toWrite;
  }

  toJSON(): { type: 'Buffer'; data: number[] } {
    return { type: 'Buffer', data: Array.from(this) };
  }

  copy(target: Buffer | Uint8Array, targetStart = 0, sourceStart = 0, sourceEnd = this.length): number {
    const slice = this.subarray(sourceStart, sourceEnd);
    const len = Math.min(slice.length, target.length - targetStart);
    target.set(slice.subarray(0, len), targetStart);
    return len;
  }

  equals(other: Uint8Array): boolean {
    if (this.length !== other.length) return false;
    for (let i = 0; i < this.length; i++) {
      if (this[i] !== other[i]) return false;
    }
    return true;
  }

  slice(start?: number, end?: number): Buffer {
    const sliced = super.slice(start, end);
    return Buffer.from(sliced);
  }
}

export default Buffer;
