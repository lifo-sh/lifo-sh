import { Buffer } from './buffer.js';

export function randomBytes(size: number): Buffer {
  const buf = Buffer.alloc(size);
  crypto.getRandomValues(buf);
  return buf;
}

export function randomUUID(): string {
  return crypto.randomUUID();
}

interface HashObject {
  update(data: string | Uint8Array): HashObject;
  digest(encoding?: string): Promise<string | Buffer>;
}

export function createHash(algorithm: string): HashObject {
  const algoMap: Record<string, string> = {
    sha1: 'SHA-1',
    'sha-1': 'SHA-1',
    sha256: 'SHA-256',
    'sha-256': 'SHA-256',
    sha384: 'SHA-384',
    'sha-384': 'SHA-384',
    sha512: 'SHA-512',
    'sha-512': 'SHA-512',
  };

  const webAlgo = algoMap[algorithm.toLowerCase()];
  if (!webAlgo) {
    throw new Error(`Digest method not supported: ${algorithm}`);
  }

  const chunks: Uint8Array[] = [];

  return {
    update(data: string | Uint8Array): ReturnType<typeof createHash> {
      if (typeof data === 'string') {
        chunks.push(new TextEncoder().encode(data));
      } else {
        chunks.push(data);
      }
      return this;
    },
    async digest(encoding?: string): Promise<string | Buffer> {
      let totalLen = 0;
      for (const c of chunks) totalLen += c.length;
      const merged = new Uint8Array(totalLen);
      let offset = 0;
      for (const c of chunks) {
        merged.set(c, offset);
        offset += c.length;
      }

      const hashBuffer = await crypto.subtle.digest(webAlgo, merged);
      const result = Buffer.from(hashBuffer);

      if (encoding === 'hex') return result.toString('hex');
      if (encoding === 'base64') return result.toString('base64');
      return result;
    },
  };
}

export function randomInt(min: number, max?: number): number {
  if (max === undefined) {
    max = min;
    min = 0;
  }
  const range = max - min;
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return min + (array[0] % range);
}

export default { randomBytes, randomUUID, createHash, randomInt };
