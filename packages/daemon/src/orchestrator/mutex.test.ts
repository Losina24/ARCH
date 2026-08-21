import { describe, expect, it } from 'vitest';
import { Mutex } from './mutex.js';

describe('Mutex', () => {
  it('grants the lock immediately when unlocked', async () => {
    const mutex = new Mutex();
    const unlock = await mutex.lock();
    expect(typeof unlock).toBe('function');
  });

  it('blocks a second lock() until the first is released', async () => {
    const mutex = new Mutex();
    const unlockFirst = await mutex.lock();

    let secondAcquired = false;
    const secondLock = mutex.lock().then((unlock) => {
      secondAcquired = true;
      return unlock;
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(secondAcquired).toBe(false);

    unlockFirst();
    const unlockSecond = await secondLock;
    expect(secondAcquired).toBe(true);
    unlockSecond();
  });

  it('grants queued waiters access in FIFO order', async () => {
    const mutex = new Mutex();
    const order: number[] = [];

    const unlockFirst = await mutex.lock();
    const p2 = mutex.lock().then((unlock) => {
      order.push(2);
      return unlock;
    });
    const p3 = mutex.lock().then((unlock) => {
      order.push(3);
      return unlock;
    });

    unlockFirst();
    const unlock2 = await p2;
    unlock2();
    const unlock3 = await p3;
    unlock3();

    expect(order).toEqual([2, 3]);
  });
});
