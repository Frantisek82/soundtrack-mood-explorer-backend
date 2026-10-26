import { beforeEach, describe, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({
  open: vi.fn(),
  close: vi.fn(),
  pending: vi.fn(),
  complete: vi.fn(),
}));

vi.mock("@/lib/deletion-history/client", () => ({
  openDeletionHistoryDatabase: boundary.open,
}));

vi.mock("@/lib/deletion-history/store", () => ({
  createDeletionIntentStore: () => ({
    recordPending: boundary.pending,
    markLiveCleanupCompleted: boundary.complete,
  }),
}));

import { executeRecordedAccountDeletion } from "@/lib/deletion-history/execute";

const userId = "a".repeat(24);

describe("Recorded account-deletion orchestration", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    boundary.open.mockResolvedValue({
      database: {},
      close: boundary.close,
    });
    boundary.close.mockResolvedValue(undefined);
    boundary.pending.mockResolvedValue(undefined);
    boundary.complete.mockResolvedValue(undefined);
  });

  it("records before cleanup and completes only after cleanup resolves", async () => {
    const order: string[] = [];
    boundary.pending.mockImplementation(async () => { order.push("pending"); });
    boundary.complete.mockImplementation(async () => { order.push("completed"); });
    boundary.close.mockImplementation(async () => { order.push("closed"); });
    const cleanup = vi.fn(async () => {
      order.push("committed");
      return 7;
    });

    await expect(executeRecordedAccountDeletion(userId, cleanup)).resolves.toBe(7);
    expect(order).toEqual(["pending", "committed", "completed", "closed"]);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(boundary.pending).toHaveBeenCalledOnce();
    expect(boundary.complete).toHaveBeenCalledWith(
      boundary.pending.mock.calls[0][0],
    );

    const reference = boundary.pending.mock.calls[0][0];
    expect(Object.keys(reference).sort()).toEqual([
      "digest", "keyVersion", "namespace",
    ]);
    expect(reference.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(reference)).not.toContain(userId);
  });

  it("does not run cleanup if opening storage fails", async () => {
    const failure = new Error("synthetic-open-failure");
    boundary.open.mockRejectedValueOnce(failure);
    const cleanup = vi.fn();

    await expect(executeRecordedAccountDeletion(userId, cleanup))
      .rejects.toBe(failure);
    expect(cleanup).not.toHaveBeenCalled();
    expect(boundary.pending).not.toHaveBeenCalled();
    expect(boundary.close).not.toHaveBeenCalled();
  });

  it("does not run cleanup after an uncertain intent write", async () => {
    const failure = new Error("synthetic-intent-failure");
    boundary.pending.mockRejectedValueOnce(failure);
    const cleanup = vi.fn();

    await expect(executeRecordedAccountDeletion(userId, cleanup))
      .rejects.toBe(failure);
    expect(cleanup).not.toHaveBeenCalled();
    expect(boundary.complete).not.toHaveBeenCalled();
    expect(boundary.close).toHaveBeenCalledOnce();
  });

  it("does not complete an intent when cleanup fails", async () => {
    const failure = new Error("synthetic-cleanup-failure");

    await expect(executeRecordedAccountDeletion(userId, async () => {
      throw failure;
    })).rejects.toBe(failure);
    expect(boundary.pending).toHaveBeenCalledOnce();
    expect(boundary.complete).not.toHaveBeenCalled();
    expect(boundary.close).toHaveBeenCalledOnce();
  });

  it("preserves committed success when the completion marker fails", async () => {
    boundary.complete.mockRejectedValueOnce(new Error("synthetic-marker-failure"));

    await expect(executeRecordedAccountDeletion(userId, async () => 7))
      .resolves.toBe(7);
    expect(boundary.pending).toHaveBeenCalledOnce();
    expect(boundary.close).toHaveBeenCalledOnce();
  });

  it("preserves committed success when disposal fails", async () => {
    boundary.close.mockRejectedValueOnce(new Error("synthetic-close-failure"));

    await expect(executeRecordedAccountDeletion(userId, async () => 7))
      .resolves.toBe(7);
    expect(boundary.complete).toHaveBeenCalledOnce();
  });

  it("preserves the original cleanup failure when disposal also fails", async () => {
    const failure = new Error("synthetic-cleanup-failure");
    boundary.close.mockRejectedValueOnce(new Error("synthetic-close-failure"));

    await expect(executeRecordedAccountDeletion(userId, async () => {
      throw failure;
    })).rejects.toBe(failure);
    expect(boundary.complete).not.toHaveBeenCalled();
  });
});
