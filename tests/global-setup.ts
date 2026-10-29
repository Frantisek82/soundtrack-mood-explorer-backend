import { MongoMemoryReplSet } from "mongodb-memory-server";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    mongoUri: string;
    deletionHistoryMongoUri: string;
  }
}

export default async function globalSetup(project: TestProject) {
  const application = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  let register: MongoMemoryReplSet | undefined;

  try {
    register = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: "wiredTiger" },
    });

    project.provide(
      "mongoUri",
      application.getUri("soundtrack-mood-explorer-test"),
    );
    project.provide(
      "deletionHistoryMongoUri",
      register.getUri("sme-deletion-history-test"),
    );
  } catch (error) {
    try {
      if (register) await register.stop();
    } finally {
      await application.stop();
    }
    throw error;
  }

  return async () => {
    try {
      if (register) await register.stop();
    } finally {
      await application.stop();
    }
  };
}
