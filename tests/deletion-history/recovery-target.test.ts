import { describe, expect, it } from "vitest";

import {
  getRecoveryTestTarget,
  RECOVERY_TEST_DATABASE,
  RecoveryTargetError,
} from "@/lib/deletion-history/recovery-target";

const valid = {
  NODE_ENV: "test",
  RECOVERY_TEST_OPT_IN: "isolated-synthetic-recovery",
  RECOVERY_MONGODB_URI:
    "mongodb://127.0.0.1:27019/sme-quarantined-recovery-test?replicaSet=test",
  MONGODB_URI:
    "mongodb://127.0.0.1:27017/soundtrack-mood-explorer-test",
  DELETION_HISTORY_MONGODB_URI:
    "mongodb://127.0.0.1:27018/sme-deletion-history-test",
};

describe("Synthetic quarantined recovery target", () => {
  it("accepts a distinct explicit temporary target without connecting", () => {
    expect(getRecoveryTestTarget(valid)).toEqual({
      uri: valid.RECOVERY_MONGODB_URI,
      databaseName: RECOVERY_TEST_DATABASE,
    });
  });

  it.each([
    { NODE_ENV: "production" },
    { RECOVERY_TEST_OPT_IN: "" },
    { MONGODB_URI: "" },
    { DELETION_HISTORY_MONGODB_URI: "" },
    { RECOVERY_MONGODB_URI: "" },
    { RECOVERY_MONGODB_URI:
      "mongodb://localhost:27017/sme-quarantined-recovery-test" },
    { RECOVERY_MONGODB_URI:
      "mongodb://[::1]:27018/sme-quarantined-recovery-test" },
    { RECOVERY_MONGODB_URI:
      "mongodb://remote.example:27019/sme-quarantined-recovery-test" },
    { RECOVERY_MONGODB_URI:
      "mongodb://127.0.0.1:27019/soundtrack-mood-explorer-test" },
    { RECOVERY_MONGODB_URI:
      "mongodb://127.0.0.1:27019/sme-deletion-history-test" },
    { RECOVERY_MONGODB_URI:
      "mongodb://synthetic:synthetic@127.0.0.1:27019/sme-quarantined-recovery-test" },
    { RECOVERY_MONGODB_URI:
      "mongodb://127.0.0.1:27019/sme-quarantined-recovery-test?tls=false" },
    { RECOVERY_MONGODB_URI:
      "mongodb://127.0.0.1:27019/sme-quarantined-recovery-test?replicaSet=a&replicaSet=b" },
    { RECOVERY_MONGODB_URI:
      "mongodb://127.0.0.1:27019/sme-quarantined-recovery-test#fragment" },
    { RECOVERY_MONGODB_URI:
      "mongodb://127.0.0.1:27019/sme-quarantined-recovery-test " },
  ])("rejects unsafe or ambiguous configuration with a sanitized error", change => {
    expect(() => getRecoveryTestTarget({ ...valid, ...change }))
      .toThrow(RecoveryTargetError);
    expect(() => getRecoveryTestTarget({ ...valid, ...change }))
      .toThrow("Invalid quarantined recovery target");
  });
});
