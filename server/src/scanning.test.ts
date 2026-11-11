import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { startScanWithEnrichment } from "./scanning";
import type { ScanManager } from "./scanner";

function fakeScanner(): ScanManager {
  return {
    scanRoot: vi.fn().mockResolvedValue(undefined),
    getProgress: () => null,
  } as unknown as ScanManager;
}

const fakeLogger = () => ({ info: vi.fn(), error: vi.fn() });

function fakePrisma(roots: Array<{ id: number }>): PrismaClient {
  return {
    libraryRoot: {
      findMany: vi.fn().mockResolvedValue(roots),
    },
  } as unknown as PrismaClient;
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("startScanWithEnrichment (spec 37 step 7.8)", () => {
  it("reports no-roots when nothing is registered and never scans", async () => {
    const scanner = fakeScanner();
    const enrichment = { enqueue: vi.fn() };
    const logger = fakeLogger();
    const result = await startScanWithEnrichment(
      { prisma: fakePrisma([]), scanner, enrichment, logger },
      {},
    );
    expect(result).toEqual({ started: false, reason: "no-roots" });
    expect(scanner.scanRoot).not.toHaveBeenCalled();
    expect(enrichment.enqueue).not.toHaveBeenCalled();
  });

  it("starts each selected root and enqueues enrichment when the scan finishes", async () => {
    const scanner = fakeScanner();
    const enrichment = { enqueue: vi.fn().mockResolvedValue({ status: "queued" }) };
    const logger = fakeLogger();
    const result = await startScanWithEnrichment(
      { prisma: fakePrisma([{ id: 7 }, { id: 8 }]), scanner, enrichment, logger },
      {},
    );
    expect(result).toEqual({ started: true, rootIds: [7, 8] });
    expect(scanner.scanRoot).toHaveBeenCalledTimes(2);
    await flush();
    expect(enrichment.enqueue).toHaveBeenCalledTimes(2);
  });

  it("logs a scan failure without enqueuing enrichment", async () => {
    const scanner = {
      scanRoot: vi.fn().mockRejectedValue(new Error("boom")),
      getProgress: () => null,
    } as unknown as ScanManager;
    const enrichment = { enqueue: vi.fn() };
    const logger = fakeLogger();
    await startScanWithEnrichment(
      { prisma: fakePrisma([{ id: 3 }]), scanner, enrichment, logger },
      {},
    );
    await flush();
    expect(logger.error).toHaveBeenCalled();
    expect(enrichment.enqueue).not.toHaveBeenCalled();
  });
});
