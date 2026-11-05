import { createHmac } from "node:crypto";

export type DeletionIdentifierContext = {
  namespace: string;
  keyVersion: string;
  key: Buffer;
};

export class DeletionIdentifierError extends Error {
  constructor() {
    super("Invalid deletion identifier input");
    this.name = "DeletionIdentifierError";
  }
}

// Backend only. No environment reads, database access, or logging.
export function createDeletionIdentifier(
  userId: string,
  context: DeletionIdentifierContext,
): string {
  if (
    typeof userId !== "string" ||
    !/^[a-f0-9]{24}$/.test(userId) ||
    typeof context?.namespace !== "string" ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(context.namespace) ||
    typeof context.keyVersion !== "string" ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(context.keyVersion) ||
    !Buffer.isBuffer(context.key) ||
    context.key.length !== 32
  ) {
    throw new DeletionIdentifierError();
  }

  const message = JSON.stringify([
    "sme-account-deletion",
    1,
    context.namespace,
    context.keyVersion,
    userId,
  ]);

  return createHmac("sha256", context.key).update(message, "utf8").digest("hex");
}
