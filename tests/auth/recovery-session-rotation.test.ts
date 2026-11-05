import {
  afterEach, describe, expect, it, vi,
} from "vitest";

const payload = {
  id: "a".repeat(24),
  email: "synthetic-rotation@example.com",
};

describe("Recovery session invalidation through signing-secret rotation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("rejects tokens from both old signers after a fresh verifier loads the new secret", async () => {
    vi.stubEnv("JWT_SECRET", "synthetic-before-recovery-secret");
    vi.resetModules();
    const oldJwt = await import("@/lib/jwt");
    const oldAuth = await import("@/lib/auth");
    const oldTokens = [
      oldJwt.generateToken(payload),
      oldAuth.signToken(payload),
    ];

    for (const token of oldTokens) {
      expect(oldJwt.verifyToken(token).id).toBe(payload.id);
    }

    vi.stubEnv("JWT_SECRET", "synthetic-after-recovery-secret");
    vi.resetModules();
    const recoveredJwt = await import("@/lib/jwt");
    const recoveredAuth = await import("@/lib/auth");

    for (const token of oldTokens) {
      expect(() => recoveredJwt.verifyToken(token)).toThrow();
    }

    for (const token of [
      recoveredJwt.generateToken(payload),
      recoveredAuth.signToken(payload),
    ]) {
      expect(recoveredJwt.verifyToken(token).id).toBe(payload.id);
      expect(() => oldJwt.verifyToken(token)).toThrow();
    }
  });

  it("demonstrates that an already loaded verifier still accepts old sessions", async () => {
    vi.stubEnv("JWT_SECRET", "synthetic-before-recovery-secret");
    vi.resetModules();
    const runningInstance = await import("@/lib/jwt");
    const oldToken = runningInstance.generateToken(payload);

    vi.stubEnv("JWT_SECRET", "synthetic-after-recovery-secret");

    // Environment mutation alone does not replace a module-captured secret.
    expect(runningInstance.verifyToken(oldToken).id).toBe(payload.id);

    vi.resetModules();
    const restartedInstance = await import("@/lib/jwt");
    expect(() => restartedInstance.verifyToken(oldToken)).toThrow();
  });

  it("refuses to load the application verifier without a signing secret", async () => {
    vi.stubEnv("JWT_SECRET", "");
    vi.resetModules();

    await expect(import("@/lib/jwt"))
      .rejects.toThrow("JWT_SECRET is not defined in environment variables");
  });
});
