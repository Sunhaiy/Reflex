/** Derive each update from the last successfully persisted value, not a render snapshot. */
export function serialWriter<T>(initial: T, save: (value: T) => Promise<void>, publish: (value: T) => void) {
  let value = initial;
  let tail: Promise<void> = Promise.resolve();
  return {
    restore(next: T) {
      value = next;
      publish(next);
    },
    update(change: (current: T) => T) {
      const result = tail.then(async () => {
        const next = change(value);
        await save(next);
        value = next;
        publish(next);
      });
      tail = result.catch(() => undefined);
      return result;
    },
  };
}
