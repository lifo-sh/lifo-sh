export class StringDecoder {
  private decoder: TextDecoder;

  constructor(encoding?: string) {
    const enc = (encoding || 'utf8').toLowerCase().replace('-', '');
    const map: Record<string, string> = {
      utf8: 'utf-8',
      utf16le: 'utf-16le',
      latin1: 'latin1',
      ascii: 'ascii',
      binary: 'latin1',
    };
    this.decoder = new TextDecoder(map[enc] || 'utf-8');
  }

  write(buffer: Uint8Array): string {
    return this.decoder.decode(buffer, { stream: true });
  }

  end(buffer?: Uint8Array): string {
    if (buffer) return this.decoder.decode(buffer);
    return this.decoder.decode();
  }
}

export default { StringDecoder };
