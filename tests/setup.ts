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
