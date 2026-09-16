import { MongoMemoryServer } from "mongodb-memory-server";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    mongoUri: string;
  }
}

export default async function globalSetup(project: TestProject) {
  const mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri("soundtrack-mood-explorer-test");

  project.provide("mongoUri", mongoUri);

  return async () => {
    await mongoServer.stop();
  };
}
