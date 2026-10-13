import { describe, expect, it } from "vitest";

import User from "@/models/User";

describe("User Spotify link generation", () => {
  it("defaults to zero and is excluded from ordinary queries", async () => {
    const user = await User.create({
      name: "Generation User",
      email: "generation@example.com",
      password: "test-only-password",
    });

    const ordinary = await User.findById(user._id).lean();
    expect(ordinary).not.toHaveProperty("spotifyLinkGeneration");

    const internal = await User.findById(user._id)
      .select("+spotifyLinkGeneration")
      .lean();
    expect(internal).toHaveProperty("spotifyLinkGeneration", 0);
  });

  it("hydrates legacy users with generation zero", async () => {
    const user = await User.create({
      name: "Legacy User",
      email: "legacy-generation@example.com",
      password: "test-only-password",
    });

    await User.collection.updateOne(
      { _id: user._id },
      { $unset: { spotifyLinkGeneration: "" } },
    );

    const hydrated = await User.findById(user._id).select(
      "+spotifyLinkGeneration",
    );
    expect(hydrated?.spotifyLinkGeneration).toBe(0);
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid generation %s",
    async (generation) => {
      const user = new User({
        name: "Invalid Generation",
        email: "invalid-generation@example.com",
        password: "test-only-password",
        spotifyLinkGeneration: generation,
      });

      await expect(user.validate()).rejects.toThrow();
    },
  );
});
