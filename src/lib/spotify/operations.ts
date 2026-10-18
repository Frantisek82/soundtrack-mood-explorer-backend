export class SpotifyOperationInvalidatedError extends Error {
  constructor() {
    super("Spotify operation invalidated");
    this.name = "AbortError";
  }
}

type Operation = {
  generation: number;
  controller: AbortController;
};

type Scope = {
  userId: string;
  generation: number;
  signal?: AbortSignal;
};

const active = new Map<string, Set<Operation>>();

function validate(userId: string, generation: number) {
  if (
    !/^[a-f0-9]{24}$/.test(userId) ||
    !Number.isSafeInteger(generation) ||
    generation < 0
  ) {
    throw new Error("Invalid Spotify operation context");
  }
}

function remove(userId: string, entries: Set<Operation>, entry: Operation) {
  entries.delete(entry);
  if (entries.size === 0 && active.get(userId) === entries) {
    active.delete(userId);
  }
}

// Register before database generation validation and provider dispatch.
// Entries contain no provider credentials and are removed on completion.
export async function withSpotifyOperation<T>(
  scope: Scope,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  validate(scope.userId, scope.generation);

  const entry: Operation = {
    generation: scope.generation,
    controller: new AbortController(),
  };
  const entries = active.get(scope.userId) ?? new Set<Operation>();
  active.set(scope.userId, entries);
  entries.add(entry);

  const signal = scope.signal
    ? AbortSignal.any([scope.signal, entry.controller.signal])
    : entry.controller.signal;

  try {
    signal.throwIfAborted();
    const result = await work(signal);
    signal.throwIfAborted();
    return result;
  } catch (error) {
    if (entry.controller.signal.aborted) {
      throw entry.controller.signal.reason;
    }
    throw error;
  } finally {
    remove(scope.userId, entries, entry);
  }
}

// Call only after generation invalidation and cleanup commit.
// New-generation operations and other users' operations are preserved.
// Cross-instance work is fenced by the database rather than this local map.
export function abortSpotifyOperationsBeforeGeneration(
  userId: string,
  generation: number,
): number {
  validate(userId, generation);
  const entries = active.get(userId);
  if (!entries) return 0;

  let cancelled = 0;
  for (const entry of [...entries]) {
    if (entry.generation < generation) {
      remove(userId, entries, entry);
      entry.controller.abort(new SpotifyOperationInvalidatedError());
      cancelled += 1;
    }
  }
  return cancelled;
}
