let client;
let failed = false;
let stage = "environment guards";

const watchdog = setTimeout(() => {
  console.error("Database inspection: FAIL; operation budget exceeded.");
  process.exit(1);
}, 30_000);
watchdog.unref();

function report(name, passed) {
  console.log(`${name}: ${passed ? "PASS" : "FAIL"}`);
  if (!passed) failed = true;
}

function matchesField(index, field) {
  const key = index.key ?? {};
  return (
    Object.keys(key).length === 1 &&
    key[field] === 1 &&
    index.sparse !== true &&
    index.hidden !== true &&
    index.partialFilterExpression === undefined &&
    (index.collation === undefined || index.collation.locale === "simple")
  );
}

try {
  if (
    process.env.VERCEL_ENV !== "production" ||
    process.env.SPOTIFY_ENABLED !== "false" ||
    !process.env.MONGODB_URI
  ) {
    throw new Error();
  }

  const { default: mongoose } = await import("mongoose");
  const { MongoClient, ObjectId } = mongoose.mongo;

  client = new MongoClient(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000,
    socketTimeoutMS: 5000,
    maxPoolSize: 1,
    monitorCommands: false,
  });

  const database = client.db();

  // Refuse an unintended database before opening a connection.
  if (database.databaseName !== "soundtrack-explorer") {
    throw new Error();
  }
  console.log("Production database target: PASS");

  stage = "database connection";
  await client.connect();
  console.log("Database connection: PASS");

  stage = "transaction topology";
  const hello = await database.command({ hello: 1 }, { timeoutMS: 5000 });
  const supported =
    ((typeof hello.setName === "string" && hello.setName.length > 0) ||
      hello.msg === "isdbgrid") &&
    hello.isWritablePrimary === true &&
    hello.readOnly !== true &&
    Number.isInteger(hello.maxWireVersion) &&
    hello.maxWireVersion >= 8 &&
    Number.isFinite(hello.logicalSessionTimeoutMinutes) &&
    hello.logicalSessionTimeoutMinutes > 0;

  report("Transaction topology", supported);
  if (!supported) throw new Error();

  stage = "index inspection";
  async function indexesFor(name) {
    try {
      return await database.collection(name)
        .listIndexes({ maxTimeMS: 5000 }).toArray();
    } catch (error) {
      if (error?.code === 26) return [];
      throw error;
    }
  }

  const pluralize = mongoose.pluralize();
  const connections = await indexesFor(pluralize("SpotifyConnection"));
  const transactions = await indexesFor(pluralize("SpotifyOAuthTransaction"));

  for (const field of ["userId", "accountId"]) {
    report(
      `Connection ${field} unique index`,
      connections.some(index =>
        matchesField(index, field) && index.unique === true),
    );
  }

  report(
    "Transaction stateHash unique index",
    transactions.some(index =>
      matchesField(index, "stateHash") && index.unique === true),
  );
  report(
    "Transaction userId cleanup index",
    transactions.some(index =>
      matchesField(index, "userId") && index.unique !== true),
  );
  report(
    "Transaction expiresAt TTL index",
    transactions.some(index =>
      matchesField(index, "expiresAt") &&
      index.unique !== true &&
      index.expireAfterSeconds === 0),
  );

  stage = "transactional read";
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      await database.collection(pluralize("User")).findOne(
        { _id: new ObjectId() },
        { session, projection: { _id: 1 }, maxTimeMS: 5000 },
      );
    }, {
      readPreference: "primary",
      readConcern: { level: "snapshot" },
      writeConcern: { w: "majority" },
      maxCommitTimeMS: 5000,
    });
    console.log("Transactional read: PASS");
  } finally {
    await session.endSession();
  }
} catch {
  failed = true;
  console.error(`Database inspection: FAIL during ${stage}; details withheld.`);
} finally {
  if (client) {
    try {
      await client.close();
    } catch {
      failed = true;
      console.error("Database inspection: connection cleanup failed.");
    }
  }
  clearTimeout(watchdog);
}

process.exitCode = failed ? 1 : 0;
