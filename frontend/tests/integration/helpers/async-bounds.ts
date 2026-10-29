/** Bounded waiting helpers for integration tests: every wait names its bound, so a regression fails instead of hanging. */
export const DEFAULT_POLL_INTERVAL_MS = 25;

export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Never throws: `{ resolved: value }` or the rejection value. */
export function outcomeOf<T>(promise: Promise<T>): Promise<unknown> {
  return promise.then(
    value => ({ resolved: value }),
    (error: unknown) => error
  );
}

/** Rejects with a named error if `promise` has not settled within `boundMs`; always clears its timer. */
export async function withinBound<T>(promise: Promise<T>, boundMs: number, description: string): Promise<T> {
  let handle: NodeJS.Timeout | undefined;
  const bound = new Promise<never>((_, reject) => {
    handle = setTimeout(() => reject(new Error(`Bound exceeded after ${boundMs}ms: ${description}`)), boundMs);
  });
  try {
    return await Promise.race([promise, bound]);
  } finally {
    clearTimeout(handle);
  }
}

const DEADLINE_PASSED = Symbol('deadline passed');

async function evaluateBeforeDeadline(condition: () => Promise<boolean> | boolean, remainingMs: number): Promise<boolean | typeof DEADLINE_PASSED> {
  let handle: NodeJS.Timeout | undefined;
  const deadline = new Promise<typeof DEADLINE_PASSED>(resolve => {
    handle = setTimeout(() => resolve(DEADLINE_PASSED), remainingMs);
  });
  try {
    return await Promise.race([Promise.resolve().then(condition), deadline]);
  } finally {
    clearTimeout(handle);
  }
}

/** Polls `condition` until true; the bound also covers each evaluation, so a late or never-settling condition fails. Returns the elapsed ms, or throws naming the bound. */
export async function waitFor(
  condition: () => Promise<boolean> | boolean,
  boundMs: number,
  description: string,
  pollIntervalMs: number = DEFAULT_POLL_INTERVAL_MS
): Promise<number> {
  const startedAt = Date.now();
  const deadlineAt = startedAt + boundMs;
  while (Date.now() < deadlineAt) {
    const satisfied = await evaluateBeforeDeadline(condition, deadlineAt - Date.now());
    if (satisfied === true && Date.now() <= deadlineAt) return Date.now() - startedAt;
    if (satisfied === DEADLINE_PASSED) break;
    await delay(pollIntervalMs);
  }
  throw new Error(`Condition not met within ${boundMs}ms: ${description}`);
}
