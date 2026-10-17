import { describe, expect, it, vi } from "vitest";

import {
  abortSpotifyOperationsBeforeGeneration,
  withSpotifyOperation,
} from "@/lib/spotify/operations";

const userId = "a".repeat(24);
const otherId = "b".repeat(24);

function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => {
    release = resolve;
  });
  return { promise, release };
}

describe("Local Spotify operation cancellation", () => {
  it("cancels old-generation work without affecting another user or a newer generation", async () => {
    const pending = gate();
    let oldSignal!: AbortSignal;
    let newSignal!: AbortSignal;
    let otherSignal!: AbortSignal;

    const old = withSpotifyOperation({ userId, generation: 0 }, async signal => {
      oldSignal = signal;
      await pending.promise;
      return "old";
    });
    const newer = withSpotifyOperation({ userId, generation: 1 }, async signal => {
      newSignal = signal;
      await pending.promise;
      return "new";
    });
    const other = withSpotifyOperation(
      { userId: otherId, generation: 0 },
      async signal => {
        otherSignal = signal;
        await pending.promise;
        return "other";
      },
    );

    expect(abortSpotifyOperationsBeforeGeneration(userId, 1)).toBe(1);
    expect(oldSignal.aborted).toBe(true);
    expect(newSignal.aborted).toBe(false);
    expect(otherSignal.aborted).toBe(false);

    pending.release();

    await expect(old).rejects.toMatchObject({ name: "AbortError" });
    await expect(newer).resolves.toBe("new");
    await expect(other).resolves.toBe("other");
    expect(abortSpotifyOperationsBeforeGeneration(userId, 2)).toBe(0);
    expect(abortSpotifyOperationsBeforeGeneration(otherId, 1)).toBe(0);
  });

  it("removes completed operations", async () => {
    await expect(withSpotifyOperation(
      { userId, generation: 0 },
      async () => "complete",
    )).resolves.toBe("complete");

    expect(abortSpotifyOperationsBeforeGeneration(userId, 1)).toBe(0);
  });

  it("removes failed operations", async () => {
    await expect(withSpotifyOperation(
      { userId, generation: 0 },
      async () => { throw new Error("test-only-operation-failure"); },
    )).rejects.toThrow("test-only-operation-failure");

    expect(abortSpotifyOperationsBeforeGeneration(userId, 1)).toBe(0);
  });

  it("rejects an already-aborted external signal without starting work", async () => {
    const controller = new AbortController();
    controller.abort();
    const work = vi.fn(async () => "unexpected");

    await expect(withSpotifyOperation(
      { userId, generation: 0, signal: controller.signal },
      work,
    )).rejects.toMatchObject({ name: "AbortError" });

    expect(work).not.toHaveBeenCalled();
    expect(abortSpotifyOperationsBeforeGeneration(userId, 1)).toBe(0);
  });

  it("propagates external cancellation and discards a late result", async () => {
    const controller = new AbortController();
    const pending = gate();
    let signal!: AbortSignal;

    const operation = withSpotifyOperation(
      { userId, generation: 0, signal: controller.signal },
      async combined => {
        signal = combined;
        await pending.promise;
        return "late-result";
      },
    );

    controller.abort();
    expect(signal.aborted).toBe(true);
    pending.release();

    await expect(operation).rejects.toMatchObject({ name: "AbortError" });
    expect(abortSpotifyOperationsBeforeGeneration(userId, 1)).toBe(0);
  });

  it("handles repeated cancellation safely", async () => {
    const pending = gate();
    const operation = withSpotifyOperation(
      { userId, generation: 0 },
      async () => {
        await pending.promise;
        return "late-result";
      },
    );

    expect(abortSpotifyOperationsBeforeGeneration(userId, 1)).toBe(1);
    expect(abortSpotifyOperationsBeforeGeneration(userId, 1)).toBe(0);
    pending.release();
    await expect(operation).rejects.toMatchObject({ name: "AbortError" });
  });

  it("cancels every older generation for the selected user", async () => {
    const pending = gate();
    const operations = [0, 1].map(generation => withSpotifyOperation(
      { userId, generation },
      async () => {
        await pending.promise;
        return "late-result";
      },
    ));

    expect(abortSpotifyOperationsBeforeGeneration(userId, 2)).toBe(2);
    pending.release();

    const results = await Promise.allSettled(operations);
    expect(results.every(result => result.status === "rejected")).toBe(true);
    expect(abortSpotifyOperationsBeforeGeneration(userId, 3)).toBe(0);
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid operation generation %s",
    async generation => {
      await expect(withSpotifyOperation(
        { userId, generation },
        async () => "unexpected",
      )).rejects.toThrow("Invalid Spotify operation context");
    },
  );

  it("rejects malformed user identifiers", async () => {
    await expect(withSpotifyOperation(
      { userId: "invalid-user-id", generation: 0 },
      async () => "unexpected",
    )).rejects.toThrow("Invalid Spotify operation context");
  });
});
