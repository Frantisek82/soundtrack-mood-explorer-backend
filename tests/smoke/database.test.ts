import mongoose from "mongoose";
import { describe, expect, it } from "vitest";

import { connectDB } from "@/lib/db";

import {
  assertSafeTestDatabaseUri,
  TEST_DATABASE_NAME,
} from "../helpers/database";

const COLLECTION_NAME = "testing_foundation_records";

describe("isolated test database", () => {
  it("accepts the generated ephemeral test URI", () => {
    expect(() => assertSafeTestDatabaseUri()).not.toThrow();
  });

  it.each([
    "mongodb+srv://example.com/soundtrack-mood-explorer-test",
    "mongodb://example.com:27017/soundtrack-mood-explorer-test",
    "mongodb://127.0.0.1:27017/soundtrack-explorer",
    "mongodb://127.0.0.1:27017/production",
  ])("rejects an unsafe MongoDB URI: %s", (uri) => {
    expect(() => assertSafeTestDatabaseUri(uri)).toThrow();
  });

  it("rejects cleanup outside the test environment", () => {
    const originalNodeEnv = process.env.NODE_ENV;

    try {
      Object.assign(process.env, { NODE_ENV: "production" });

      expect(() => assertSafeTestDatabaseUri()).toThrow(
        "Database cleanup requires NODE_ENV=test",
      );
    } finally {
      Object.assign(process.env, { NODE_ENV: originalNodeEnv });
    }
  });

  it("connects through the application database helper", async () => {
    await connectDB();

    expect(mongoose.connection.readyState).toBe(1);
    expect(mongoose.connection.name).toBe(TEST_DATABASE_NAME);

    const collection = mongoose.connection.collection(COLLECTION_NAME);

    await collection.insertOne({ value: "isolated-test-record" });

    await expect(
      collection.findOne({ value: "isolated-test-record" }),
    ).resolves.toMatchObject({
      value: "isolated-test-record",
    });
  });

  it("cleans test data between tests", async () => {
    const collection = mongoose.connection.collection(COLLECTION_NAME);

    await expect(collection.countDocuments()).resolves.toBe(0);
  });
});
