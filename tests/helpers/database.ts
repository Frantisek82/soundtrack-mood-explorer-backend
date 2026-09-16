import mongoose from "mongoose";

export const TEST_DATABASE_NAME = "soundtrack-mood-explorer-test";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

type MongooseCache = {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
};

function getDatabaseName(uri: string) {
  const parsedUri = new URL(uri);
  return decodeURIComponent(parsedUri.pathname.replace(/^\//, ""));
}

export function assertSafeTestDatabaseUri(
  uri: string | undefined = process.env.MONGODB_URI,
) {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Database cleanup requires NODE_ENV=test");
  }

  if (!uri) {
    throw new Error("A test MongoDB URI is required");
  }

  if (uri.startsWith("mongodb+srv://")) {
    throw new Error("SRV MongoDB URIs are not allowed in tests");
  }

  const parsedUri = new URL(uri);
  const hostname = parsedUri.hostname.replace(/^\[|\]$/g, "");

  if (parsedUri.protocol !== "mongodb:") {
    throw new Error("Only local MongoDB URIs are allowed in tests");
  }

  if (!LOOPBACK_HOSTS.has(hostname)) {
    throw new Error("The test database must use a loopback host");
  }

  if (getDatabaseName(uri) !== TEST_DATABASE_NAME) {
    throw new Error(`The test database must be ${TEST_DATABASE_NAME}`);
  }
}

export async function connectTestDatabase() {
  const uri = process.env.MONGODB_URI;

  assertSafeTestDatabaseUri(uri);

  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(uri as string);
  }

  if (
    mongoose.connection.readyState !== 1 ||
    mongoose.connection.name !== TEST_DATABASE_NAME
  ) {
    throw new Error("Mongoose is not connected to the isolated test database");
  }
}

export async function clearTestDatabase() {
  assertSafeTestDatabaseUri();

  if (
    mongoose.connection.readyState !== 1 ||
    mongoose.connection.name !== TEST_DATABASE_NAME
  ) {
    throw new Error("Refusing to clean an unverified database connection");
  }

  const database = mongoose.connection.db;

  if (!database) {
    throw new Error("The isolated test database is unavailable");
  }

  const collections = await database.collections();

  await Promise.all(collections.map((collection) => collection.deleteMany({})));
}

export async function disconnectTestDatabase() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }

  const globalWithMongoose = globalThis as typeof globalThis & {
    mongoose?: MongooseCache;
  };

  if (globalWithMongoose.mongoose) {
    globalWithMongoose.mongoose.conn = null;
    globalWithMongoose.mongoose.promise = null;
  }
}
