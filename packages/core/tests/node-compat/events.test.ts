import { describe, it, expect } from 'vitest';
import { EventEmitter } from '../../src/node-compat/events.js';

describe('EventEmitter', () => {
  it('on + emit delivers events', () => {
    const ee = new EventEmitter();
    const results: string[] = [];
    ee.on('data', (msg) => results.push(msg as string));
    ee.emit('data', 'hello');
    ee.emit('data', 'world');
    expect(results).toEqual(['hello', 'world']);
  });

  it('once fires only once', () => {
    const ee = new EventEmitter();
    let count = 0;
    ee.once('event', () => count++);
    ee.emit('event');
    ee.emit('event');
    expect(count).toBe(1);
  });

  it('removeListener stops delivery', () => {
    const ee = new EventEmitter();
    let count = 0;
    const fn = () => count++;
    ee.on('event', fn);
    ee.emit('event');
    ee.removeListener('event', fn);
    ee.emit('event');
    expect(count).toBe(1);
  });

  it('off is an alias for removeListener', () => {
    const ee = new EventEmitter();
    let count = 0;
    const fn = () => count++;
    ee.on('event', fn);
    ee.emit('event');
    ee.off('event', fn);
    ee.emit('event');
    expect(count).toBe(1);
  });

  it('listenerCount is accurate', () => {
    const ee = new EventEmitter();
    expect(ee.listenerCount('event')).toBe(0);
    const fn1 = () => {};
    const fn2 = () => {};
    ee.on('event', fn1);
    ee.on('event', fn2);
    expect(ee.listenerCount('event')).toBe(2);
    ee.off('event', fn1);
    expect(ee.listenerCount('event')).toBe(1);
  });

  it('removeAllListeners clears all for an event', () => {
    const ee = new EventEmitter();
    ee.on('a', () => {});
    ee.on('a', () => {});
    ee.on('b', () => {});
    ee.removeAllListeners('a');
    expect(ee.listenerCount('a')).toBe(0);
    expect(ee.listenerCount('b')).toBe(1);
  });

  it('removeAllListeners with no args clears everything', () => {
    const ee = new EventEmitter();
    ee.on('a', () => {});
    ee.on('b', () => {});
    ee.removeAllListeners();
    expect(ee.listenerCount('a')).toBe(0);
    expect(ee.listenerCount('b')).toBe(0);
  });

  it('emit returns false when no listeners', () => {
    const ee = new EventEmitter();
    expect(ee.emit('nothing')).toBe(false);
  });

  it('emit returns true when listeners exist', () => {
    const ee = new EventEmitter();
    ee.on('event', () => {});
    expect(ee.emit('event')).toBe(true);
  });

  it('passes multiple args to listeners', () => {
    const ee = new EventEmitter();
    const results: unknown[] = [];
    ee.on('event', (a, b, c) => results.push(a, b, c));
    ee.emit('event', 1, 'two', true);
    expect(results).toEqual([1, 'two', true]);
  });

  it('eventNames returns active event names', () => {
    const ee = new EventEmitter();
    ee.on('foo', () => {});
    ee.on('bar', () => {});
    expect(ee.eventNames().sort()).toEqual(['bar', 'foo']);
  });
});
