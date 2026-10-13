import { MongoMemoryReplSet } from "mongodb-memory-server";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    mongoUri: string;
  }
}

export default async function globalSetup(project: TestProject) {
  const mongoServer = await MongoMemoryReplSet.create({
    replSet: {
      count: 1,
      storageEngine: "wiredTiger",
    },
  });

  try {
    project.provide(
      "mongoUri",
      mongoServer.getUri("soundtrack-mood-explorer-test"),
    );
  } catch (error) {
    await mongoServer.stop();
    throw error;
  }

  return async () => {
    await mongoServer.stop();
  };
}
