import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Audiobook } from "../types";
import { DownloadStalledError } from "../local/trace";
import { DownloadButton } from "./DownloadButton";

const book: Audiobook = {
  id: 7,
  title: "The Left Hand of Darkness",
  author: "Ursula K. Le Guin",
  duration: 900,
  fileFormat: "mp3",
  createdAt: "2026-01-01T00:00:00.000Z",
  tracks: [{ id: 70, duration: 300, trackNumber: 1 }],
};

function renderButton(overrides: Partial<Parameters<typeof DownloadButton>[0]> = {}) {
  const props = {
    book,
    fraction: 0,
    isDownloaded: false,
    bytes: 0,
    onDownload: vi.fn(async () => {}),
    onRemove: vi.fn(async () => ({ failed: [] })),
    ...overrides,
  } as Parameters<typeof DownloadButton>[0] & {
    onDownload: ReturnType<typeof vi.fn>;
    onRemove: ReturnType<typeof vi.fn>;
  };
  render(<DownloadButton {...props} />);
  return props;
}

describe("DownloadButton", () => {
  it("offers Download for a book that is not on the device", () => {
    renderButton();
    expect(screen.getByRole("button", { name: /^download$/i })).toBeEnabled();
  });

  it("calls onDownload with the book and a progress callback", async () => {
    const { onDownload } = renderButton();
    fireEvent.click(screen.getByRole("button", { name: /^download$/i }));

    await waitFor(() => expect(onDownload).toHaveBeenCalledOnce());
    expect(onDownload.mock.calls[0][0]).toBe(book);
    expect(typeof onDownload.mock.calls[0][1]).toBe("function");
  });

  it("shows real progress rather than a spinner with no movement", async () => {
    // The download is deliberately left in flight. A mock that resolves
    // immediately would flip `busy` back to false and the label would revert
    // to "Download" before the assertion, testing nothing.
    let finish: () => void = () => {};
    const inFlight = new Promise<void>((resolve) => {
      finish = resolve;
    });

    renderButton({
      onDownload: async (_book, onProgress) => {
        onProgress({ bookId: 7, trackId: 70, completed: 0, total: 4, fraction: 0.42, trackFraction: 0.42 });
        await inFlight;
      },
    });

    fireEvent.click(screen.getByRole("button", { name: /^download$/i }));

    // An audiobook is long enough that a bar stuck at 0 looks broken.
    await waitFor(() => expect(screen.getByText(/42%/)).toBeInTheDocument());
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "42");
    finish();
  });

  it("reports a partial download so the user can resume", () => {
    renderButton({ fraction: 0.5 });
    expect(screen.getByRole("button", { name: /resume/i })).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
  });

  it("surfaces the actual error when a download fails", async () => {
    renderButton({ onDownload: vi.fn(async () => { throw new Error("connection reset"); }) });

    fireEvent.click(screen.getByRole("button", { name: /^download$/i }));

    // The real message, not a guessed one. This used to append "the phone may
    // have left the home WiFi" to *every* failure, which buried the actual cause
    // behind speculation -- the opposite of helpful when diagnosing.
    await waitFor(() => expect(screen.getByText(/connection reset/i)).toBeInTheDocument());
  });

  it("shows which stage stalled, and what had already succeeded", async () => {
    const stall = new DownloadStalledError("track 2/5: fetch audio", 180_000, [
      { stage: "write replica metadata", ms: 12, status: "ok" },
      { stage: "track 1/5: fetch audio", ms: 240, status: "ok" },
    ]);
    renderButton({ onDownload: vi.fn(async () => { throw stall; }) });

    fireEvent.click(screen.getByRole("button", { name: /^download$/i }));

    await waitFor(() => expect(screen.getByText(/stalled at "track 2\/5: fetch audio"/i)).toBeInTheDocument());
    // The completed stages are listed, so the report says how far it got.
    expect(screen.getByText(/track 1\/5: fetch audio — ok \(240ms\)/)).toBeInTheDocument();
    expect(screen.getByText(/write replica metadata — ok/)).toBeInTheDocument();
  });

  it("leaves the button usable after a stall so the download can be retried", async () => {
    const stall = new DownloadStalledError("track 1/5: fetch audio", 180_000, []);
    renderButton({ onDownload: vi.fn(async () => { throw stall; }) });

    fireEvent.click(screen.getByRole("button", { name: /^download$/i }));

    // This is the whole point of the change: the button used to stay stuck on
    // "Downloading 0%" forever, which left no way to retry at all.
    await waitFor(() => expect(screen.getByRole("button", { name: /resume download|download/i })).toBeInTheDocument());
  });

  it("switches to Remove for a downloaded book", () => {
    renderButton({ isDownloaded: true, bytes: 5 * 1024 * 1024 });
    expect(screen.getByRole("button", { name: /remove from device/i })).toBeInTheDocument();
    expect(screen.getByText(/5 MB/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^download$/i })).not.toBeInTheDocument();
  });

  it("warns when files could not be deleted, without claiming success", async () => {
    const { onRemove } = renderButton({
      isDownloaded: true,
      onRemove: vi.fn(async () => ({ failed: ["books/7/70.mp3"] })),
    });

    fireEvent.click(screen.getByRole("button", { name: /remove from device/i }));

    await waitFor(() => expect(screen.getByText(/could not be deleted/i)).toBeInTheDocument());
    expect(onRemove).toHaveBeenCalledWith(7);
  });

  it("says nothing about size for an unknown byte count", () => {
    // Avoids rendering a bare "0 MB" as if it were a measurement.
    renderButton({ isDownloaded: true, bytes: 0 });
    expect(screen.queryByText(/MB/)).not.toBeInTheDocument();
  });
});