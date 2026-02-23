import { describe, it, expect } from 'vitest';
import { TerminalStdin } from '../../src/shell/terminal-stdin.js';

describe('TerminalStdin', () => {
  it('feed before read returns buffered data', async () => {
    const ts = new TerminalStdin();
    ts.feed('hello\n');
    const result = await ts.read();
    expect(result).toBe('hello\n');
  });

  it('read waits for feed', async () => {
    const ts = new TerminalStdin();
    const promise = ts.read();
    expect(ts.isWaiting).toBe(true);
    ts.feed('line1\n');
    const result = await promise;
    expect(result).toBe('line1\n');
    expect(ts.isWaiting).toBe(false);
  });

  it('close resolves pending read with null', async () => {
    const ts = new TerminalStdin();
    const promise = ts.read();
    expect(ts.isWaiting).toBe(true);
    ts.close();
    const result = await promise;
    expect(result).toBeNull();
    expect(ts.isWaiting).toBe(false);
  });

  it('read after close returns null immediately', async () => {
    const ts = new TerminalStdin();
    ts.close();
    const result = await ts.read();
    expect(result).toBeNull();
  });

  it('feed after close is ignored', async () => {
    const ts = new TerminalStdin();
    ts.close();
    ts.feed('ignored\n');
    const result = await ts.read();
    expect(result).toBeNull();
  });

  it('multiple feeds are buffered in order', async () => {
    const ts = new TerminalStdin();
    ts.feed('a\n');
    ts.feed('b\n');
    ts.feed('c\n');
    expect(await ts.read()).toBe('a\n');
    expect(await ts.read()).toBe('b\n');
    expect(await ts.read()).toBe('c\n');
  });

  it('readAll collects all input until close', async () => {
    const ts = new TerminalStdin();
    ts.feed('line1\n');
    ts.feed('line2\n');

    // Start readAll, then close after a tick
    const promise = ts.readAll();
    await new Promise((r) => setTimeout(r, 10));
    ts.close();

    const result = await promise;
    expect(result).toBe('line1\nline2\n');
  });

  it('isWaiting is false when not reading', () => {
    const ts = new TerminalStdin();
    expect(ts.isWaiting).toBe(false);
  });

  it('isWaiting is false when buffer has data', async () => {
    const ts = new TerminalStdin();
    ts.feed('data\n');
    // read() returns immediately from buffer, no waiting
    const result = await ts.read();
    expect(result).toBe('data\n');
    expect(ts.isWaiting).toBe(false);
  });

  it('double close is safe', () => {
    const ts = new TerminalStdin();
    ts.close();
    ts.close(); // should not throw
  });
});
