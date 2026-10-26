import { afterAll, beforeAll, beforeEach, inject } from "vitest";

import {
  clearTestDatabase,
  connectTestDatabase,
  disconnectTestDatabase,
} from "./helpers/database";

const mongoUri = inject("mongoUri");

Object.assign(process.env, {
  NODE_ENV: "test",
  MONGODB_URI: mongoUri,
  JWT_SECRET: "test-jwt-secret",
  // Never inherit live deletion-register configuration in test workers.
  DELETION_HISTORY_MONGODB_URI: "",
  DELETION_HISTORY_NAMESPACE: "synthetic-test",
  DELETION_HISTORY_ACTIVE_KEY_VERSION: "test-v1",
  DELETION_HISTORY_HMAC_KEYS: JSON.stringify({
    "test-v1": Buffer.alloc(32, 7).toString("base64"),
  }),
});

beforeAll(async () => {
  await connectTestDatabase();
});

beforeEach(async () => {
  await clearTestDatabase();
});

afterAll(async () => {
  await disconnectTestDatabase();
});
