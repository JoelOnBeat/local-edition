const tails = new Map<string, Promise<unknown>>();

/** Runs `fn` after every earlier call with the same key in this isolate has finished (exact inside one isolate; KV callers are best effort across isolates). */
export function serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const run = (tails.get(key) ?? Promise.resolve()).then(fn, fn);
  const tail = run.catch(() => undefined);
  tails.set(key, tail);
  void tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key);
  });
  return run;
}
