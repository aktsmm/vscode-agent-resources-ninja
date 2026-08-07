/**
 * Serializes read-modify-write passes over a shared file. Commands, config
 * listeners, the chat participant, and the language-model tools all trigger
 * these independently, and two interleaved passes would let the later write
 * drop what the earlier one just added.
 */
export function createSerialQueue(): <T>(task: () => Promise<T>) => Promise<T> {
  let pending: Promise<void> = Promise.resolve();

  return <T>(task: () => Promise<T>): Promise<T> => {
    const result = pending.then(task, task);
    pending = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}
