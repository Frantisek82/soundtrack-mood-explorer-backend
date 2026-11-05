import { getDeletionIdentityConfig } from "./config";
import {
  type ExpectedReconciliationTopology,
  ReconciliationTopologyError,
  verifySeparateReconciliationTopologies,
} from "./reconcile-topology";

type DatabaseProbe = {
  readonly databaseName: string;
  command(
    command: { hello: 1 },
    options: { timeoutMS: number },
  ): Promise<unknown>;
};

export type ReconciliationTargetProbe = {
  database: DatabaseProbe;
  expectedDatabaseName: string;
  expectedTopology: ExpectedReconciliationTopology;
};

// Read-only. Caller must supply the same connections used for processing.
// Passing this check does not authorize recovery, cutover, or OAuth enablement.
export async function verifyReconciliationConnections(input: {
  application: ReconciliationTargetProbe;
  register: ReconciliationTargetProbe;
  expectedNamespace: string;
}): Promise<void> {
  try {
    const config = getDeletionIdentityConfig();
    if (config.namespace !== input.expectedNamespace) {
      throw new ReconciliationTopologyError();
    }

    for (const target of [input.application, input.register]) {
      if (
        typeof target.expectedDatabaseName !== "string" ||
        !/^[A-Za-z0-9_-]{1,63}$/.test(target.expectedDatabaseName) ||
        target.database.databaseName !== target.expectedDatabaseName
      ) throw new ReconciliationTopologyError();
    }

    const application = await input.application.database.command(
      { hello: 1 }, { timeoutMS: 5000 },
    );
    const register = await input.register.database.command(
      { hello: 1 }, { timeoutMS: 5000 },
    );

    verifySeparateReconciliationTopologies(
      { observed: application, expected: input.application.expectedTopology },
      { observed: register, expected: input.register.expectedTopology },
    );
  } catch {
    throw new ReconciliationTopologyError();
  }
}
