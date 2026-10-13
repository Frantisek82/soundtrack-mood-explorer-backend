import mongoose from "mongoose";
import { beforeAll, describe, expect, it } from "vitest";

import User from "@/models/User";

describe("isolated MongoDB transactions", () => {
  beforeAll(async () => {
    await User.init();
  });

  it("commits multiple writes together", async () => {
    await mongoose.connection.transaction(async (session) => {
      await new User({
        name: "Transaction First",
        email: "transaction-first@example.com",
        password: "test-only-password",
      }).save({ session });

      await new User({
        name: "Transaction Second",
        email: "transaction-second@example.com",
        password: "test-only-password",
      }).save({ session });
    });

    await expect(
      User.countDocuments({
        email: {
          $in: [
            "transaction-first@example.com",
            "transaction-second@example.com",
          ],
        },
      }),
    ).resolves.toBe(2);
  });

  it("rolls back both an update and an insertion on failure", async () => {
    const original = await User.create({
      name: "Original Name",
      email: "transaction-original@example.com",
      password: "test-only-password",
    });

    await expect(
      mongoose.connection.transaction(async (session) => {
        await User.updateOne(
          { _id: original._id },
          { $set: { name: "Changed Name" } },
          { session },
        );

        await new User({
          name: "Rolled Back",
          email: "transaction-rollback@example.com",
          password: "test-only-password",
        }).save({ session });

        throw new Error("Intentional transaction failure");
      }),
    ).rejects.toThrow("Intentional transaction failure");

    const persisted = await User.findById(original._id);
    expect(persisted?.name).toBe("Original Name");

    await expect(
      User.findOne({ email: "transaction-rollback@example.com" }),
    ).resolves.toBeNull();
  });
});
