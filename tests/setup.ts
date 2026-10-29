import { openDeletionHistoryDatabase } from "@/lib/deletion-history/client";
import { afterAll, beforeAll, beforeEach, inject } from "vitest";

import {
  clearTestDatabase,
  connectTestDatabase,
  disconnectTestDatabase,
} from "./helpers/database";

const mongoUri = inject("mongoUri");
const deletionHistoryMongoUri = inject("deletionHistoryMongoUri");
let register: Awaited<ReturnType<typeof openDeletionHistoryDatabase>>;

Object.assign(process.env, {
  NODE_ENV: "test",
  MONGODB_URI: mongoUri,
  JWT_SECRET: "test-jwt-secret",
  // Use only the separate temporary register supplied by global setup.
  DELETION_HISTORY_MONGODB_URI: deletionHistoryMongoUri,
  DELETION_HISTORY_NAMESPACE: "synthetic-test",
  DELETION_HISTORY_ACTIVE_KEY_VERSION: "test-v1",
  DELETION_HISTORY_HMAC_KEYS: JSON.stringify({
    "test-v1": Buffer.alloc(32, 7).toString("base64"),
  }),
});

beforeAll(async () => {
  await connectTestDatabase();
  register = await openDeletionHistoryDatabase();
});

beforeEach(async () => {
  await clearTestDatabase();
  // Only this isolated temporary register; never application database cleanup.
  await register.database.collection("accountdeletionintents").deleteMany({});
});

afterAll(async () => {
  try {
    if (register) await register.close();
  } finally {
    await disconnectTestDatabase();
  }
});
