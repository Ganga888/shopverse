export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function withTimeout<T>(p: Promise<T>, ms: number, what = 'operation'): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface Stoppable {
  stop(): Promise<void>;
}

/** Run `fn` every `intervalMs` until stopped; stop() waits for an in-flight run to finish. */
export function startLoop(name: string, intervalMs: number, fn: () => Promise<void>, onError: (err: unknown) => void): Stoppable {
  let stopped = false;
  let current: Promise<void> = Promise.resolve();
  let wake: (() => void) | undefined;
  const run = async () => {
    while (!stopped) {
      current = fn().catch(onError);
      await current;
      if (stopped) break;
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, intervalMs);
        wake = () => {
          clearTimeout(t);
          resolve();
        };
      });
    }
  };
  void run();
  return {
    async stop() {
      stopped = true;
      wake?.();
      await current;
    },
    toString: () => name,
  } as Stoppable;
}
