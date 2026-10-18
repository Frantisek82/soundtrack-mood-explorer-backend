import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { deleteApplicationAccount } from "@/lib/account-deletion";
import { disconnectSpotifyAccount } from "@/lib/spotify/disconnect";
import {
  abortSpotifyOperationsBeforeGeneration,
  SpotifyOperationInvalidatedError,
  withSpotifyOperation,
} from "@/lib/spotify/operations";
import SpotifyConnection from "@/models/SpotifyConnection";
import SpotifyOAuthTransaction from "@/models/SpotifyOAuthTransaction";
import User from "@/models/User";
import Favorite from "@/models/Favorite";

function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

async function user() {
  const record = await User.create({
    name: "Operation Cleanup User",
    email: "operation-cleanup@example.com",
    password: "test-only-password",
  });
  return record._id.toString();
}

describe("Post-commit Spotify cancellation", () => {
  beforeAll(async () => {
    await User.init();
    await Favorite.init();
    await SpotifyConnection.init();
    await SpotifyOAuthTransaction.init();
  });

  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("Provider HTTP is forbidden in cleanup coordination"),
    );
  });

  afterEach(() => {
    try {
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it.each(["disconnect", "delete"])(
    "cancels old work after %s commits",
    async action => {
      const userId = await user();
      const pending = gate();
      let operationSignal!: AbortSignal;

      const operation = withSpotifyOperation(
        { userId, generation: 0 },
        async signal => {
          operationSignal = signal;
          await pending.promise;
          return "late-result";
        },
      );

      try {
        if (action === "delete") {
          await deleteApplicationAccount(userId);
        } else {
          await disconnectSpotifyAccount(userId);
        }

        expect(operationSignal.aborted).toBe(true);
        expect(operationSignal.reason)
          .toBeInstanceOf(SpotifyOperationInvalidatedError);

        if (action === "delete") {
          await expect(User.findById(userId)).resolves.toBeNull();
        } else {
          const remaining = await User.findById(userId)
            .select("+spotifyLinkGeneration");
          expect(remaining?.spotifyLinkGeneration).toBe(1);
        }
      } finally {
        pending.release();
        await expect(operation).rejects.toBeInstanceOf(
          SpotifyOperationInvalidatedError,
        );
      }

      expect(abortSpotifyOperationsBeforeGeneration(userId, 2)).toBe(0);
    },
  );

  it.each(["disconnect", "delete"])(
    "does not cancel valid work when %s rolls back",
    async action => {
      const userId = await user();
      const pending = gate();
      let operationSignal!: AbortSignal;

      const operation = withSpotifyOperation(
        { userId, generation: 0 },
        async signal => {
          operationSignal = signal;
          await pending.promise;
          return "still-valid";
        },
      );

      if (action === "delete") {
        vi.spyOn(User, "deleteOne").mockImplementationOnce(() => {
          throw new Error("test-only-cleanup-failure");
        });
      } else {
        vi.spyOn(SpotifyOAuthTransaction, "deleteMany").mockImplementationOnce(() => {
          throw new Error("test-only-cleanup-failure");
        });
      }

      try {
        await expect(
          action === "delete"
            ? deleteApplicationAccount(userId)
            : disconnectSpotifyAccount(userId),
        ).rejects.toThrow("test-only-cleanup-failure");

        expect(operationSignal.aborted).toBe(false);
        const remaining = await User.findById(userId)
          .select("+spotifyLinkGeneration");
        expect(remaining?.spotifyLinkGeneration).toBe(0);
      } finally {
        pending.release();
        await expect(operation).resolves.toBe("still-valid");
      }

      expect(abortSpotifyOperationsBeforeGeneration(userId, 1)).toBe(0);
    },
  );
});
