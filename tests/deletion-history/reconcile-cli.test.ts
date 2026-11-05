import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const executable = resolve(root, "node_modules/.bin/tsx");
const script = resolve(root, "scripts/reconcile-deletions.mts");

function run(args: string[], cwd = root) {
  return spawnSync(executable, [
    "--tsconfig", resolve(root, "tsconfig.json"), script, ...args,
  ], {
    cwd,
    // No inherited database URIs, keys, NODE_OPTIONS, or dotenv configuration.
    env: { PATH: process.env.PATH, NODE_ENV: "production" },
    encoding: "utf8",
    timeout: 15000,
  });
}

describe("Actual reconciliation CLI process", () => {
  it("prints help without database configuration", () => {
    const result = run(["--help"]);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("No .env files are loaded.");
  });

  it.each([
    { args: [] },
    { args: ["--unknown"] },
    { args: ["--confirm", "yes"] },
    { args: ["--help", "--confirm", "reconcile-accepted-account-deletions"] },
  ])("rejects invalid arguments before loading the operator", ({ args }) => {
    const result = run(args);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("Invalid invocation. Use --help.\n");
  });

  it("loads the TypeScript operator and sanitizes missing configuration", () => {
    const result = run(["--confirm", "reconcile-accepted-account-deletions"]);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "Deletion reconciliation incomplete; earlier commits may remain. Review and retry.\n",
    );
  });

  it("does not read a local environment file", () => {
    const directory = mkdtempSync(join(tmpdir(), "sme-reconciliation-cli-"));
    try {
      for (const name of [".env", ".env.local"]) {
        writeFileSync(join(directory, name),
          "NODE_OPTIONS=--definitely-invalid-synthetic-option\n");
      }
      const result = run(["--help"], directory);
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("Account deletion reconciliation");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
