import { describe, expect, it } from "vitest";

import { DeletionHistoryConfigError } from "@/lib/deletion-history/config";
import { getDeletionHistoryTarget } from "@/lib/deletion-history/target";

const local = "mongodb://127.0.0.1:27017/sme-deletion-history-test";
const srv =
  "mongodb+srv://synthetic:synthetic@register.example.mongodb.net/sme-deletion-history";

function target(uri: string | undefined, mode = "test") {
  return getDeletionHistoryTarget({
    NODE_ENV: mode,
    DELETION_HISTORY_MONGODB_URI: uri,
  });
}

describe("Deletion-history connection targets", () => {
  it("accepts explicit isolated loopback targets without connecting", () => {
    expect(target(local)).toEqual({
      uri: local,
      databaseName: "sme-deletion-history-test",
    });
    expect(target(local + "?replicaSet=test-repl")).toBeDefined();
    expect(target(
      "mongodb://[::1]:27017/sme-deletion-history-test?directConnection=true",
    )).toBeDefined();
  });

  it.each([
    undefined,
    "",
    "private-invalid-uri",
    " " + local,
    local + "#fragment",
    local.replace("127.0.0.1", "localhost"),
    local.replace("127.0.0.1", "remote.example.com"),
    local.replace(":27017", ""),
    local.replace("sme-deletion-history-test", "soundtrack-mood-explorer-test"),
    local.replace("sme-deletion-history-test", "production"),
    local.replace("127.0.0.1", "user:secret@127.0.0.1"),
    local + "?tlsCAFile=/private/file",
    local + "?proxyHost=remote.example.com",
    local + "?replicaSet=a&replicaSet=b",
    local + "?directConnection=invalid",
    local + "?replicaSet=",
    srv,
  ])("rejects unsafe test targets with a sanitized error", uri => {
    expect(() => target(uri)).toThrow(DeletionHistoryConfigError);
    expect(() => target(uri)).toThrow("Invalid deletion-history configuration");
  });

  it("accepts the restricted Atlas URI shape outside tests", () => {
    expect(target(srv, "production").databaseName).toBe("sme-deletion-history");
    expect(target(srv + "?authSource=admin&appName=sme-register", "production"))
      .toBeDefined();
  });

  it.each([
    local,
    srv.replace("mongodb+srv:", "mongodb:"),
    srv.replace("register.example.mongodb.net", "remote.example.com"),
    srv.replace("sme-deletion-history", "application"),
    srv.replace("synthetic:synthetic@", ""),
    srv + "?tls=false",
    srv + "?tlsInsecure=true",
    srv + "?authSource=another",
    srv + "?authSource=admin&authSource=admin",
    srv + "?appName=",
  ])("rejects unsupported non-test targets", uri => {
    expect(() => target(uri, "production")).toThrow(DeletionHistoryConfigError);
  });
});
