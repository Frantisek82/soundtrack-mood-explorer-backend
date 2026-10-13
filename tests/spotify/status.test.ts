import mongoose from "mongoose";
import { describe, expect, it } from "vitest";

import { toSpotifyConnectionStatus } from "@/lib/spotify/status";
import SpotifyConnection from "@/models/SpotifyConnection";

describe("Spotify public status DTO", () => {
  it("represents an absent connection as disconnected", () => {
    expect(toSpotifyConnectionStatus(null)).toEqual({
      state: "disconnected",
      account: null,
    });
  });

  it.each(["connected", "reauthorization_required"] as const)(
    "exposes only public fields for %s",
    (status) => {
      const dto = toSpotifyConnectionStatus({
        status,
        displayName: "Test Listener",
        accountId: "private-account-id",
        userId: "private-user-id",
        accessToken: "test-only-access",
        refreshToken: "test-only-refresh",
        generation: 7,
        tokenVersion: 3,
        refreshLeaseOwner: "private-lease",
        unexpectedField: "private-value",
      });

      expect(dto).toEqual({
        state: status,
        account: { displayName: "Test Listener" },
      });
    },
  );

  it.each([null, undefined])(
    "supports an unavailable display name: %s",
    (displayName) => {
      expect(
        toSpotifyConnectionStatus({
          status: "connected",
          displayName,
        }),
      ).toEqual({
        state: "connected",
        account: { displayName: null },
      });
    },
  );

  it("reads a Mongoose document without invoking its blocked JSON serializer", () => {
    const document = new SpotifyConnection({
      userId: new mongoose.Types.ObjectId(),
      accountId: "test-account",
      status: "reauthorization_required",
      generation: 0,
      displayName: "Test Listener",
      originalAuthorizedAt: new Date(),
      estimatedRefreshExpiry: new Date(),
    });

    expect(toSpotifyConnectionStatus(document)).toEqual({
      state: "reauthorization_required",
      account: { displayName: "Test Listener" },
    });
  });

  it.each([
    undefined,
    [],
    {},
    { status: "unexpected" },
    { status: "connected", displayName: 123 },
    { status: "connected", displayName: "a".repeat(257) },
  ])("rejects malformed input without exposing its values", (value) => {
    expect(() => toSpotifyConnectionStatus(value)).toThrow(
      /^Invalid Spotify connection status$/,
    );
  });
});
