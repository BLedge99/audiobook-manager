import { describe, it, expect, vi } from "vitest";
import { sendConditional } from "./conditional";

/**
 * A produce thunk lets the cover route defer opening the file until the
 * 304 decision is known. The previous shape passed an already-open stream
 * as the payload, so a conditional revalidation opened the fd and never
 * consumed or destroyed it.
 */
function fakeReply() {
  const headers: Record<string, string> = {};
  const state = { status: 200, sent: false };
  const reply = {
    header(name: string, value: string) {
      headers[name.toLowerCase()] = value;
    },
    code(status: number) {
      state.status = status;
      return {
        send: () => {
          state.sent = true;
          return "__304__";
        },
      };
    },
  };
  return { reply, headers, state };
}

describe("sendConditional with a produce thunk", () => {
  it("does not call produce on the 304 path", () => {
    const produce = vi.fn(() => "PAYLOAD");
    // Prime the tag from a first (unconditional) call.
    const first = fakeReply();
    const produced = sendConditional({ headers: {} }, first.reply as never, undefined, {
      match: "match-key",
      produce,
    });
    expect(produced).toBe("PAYLOAD");
    expect(produce).toHaveBeenCalledTimes(1);

    const second = fakeReply();
    sendConditional(
      { headers: { "if-none-match": first.headers.etag as string } },
      second.reply as never,
      undefined,
      { match: "match-key", produce },
    );
    expect(second.state.status).toBe(304);
    expect(produce).toHaveBeenCalledTimes(1);
  });

  it("returns the produced payload on the 200 path", () => {
    const produce = vi.fn(() => "PAYLOAD");
    const res = fakeReply();
    const produced = sendConditional({ headers: {} }, res.reply as never, undefined, {
      match: "match-key",
      produce,
    });
    expect(produced).toBe("PAYLOAD");
    expect(res.state.status).toBe(200);
  });

  it("still accepts a plain payload for callers that have no stream to defer", () => {
    const res = fakeReply();
    const produced = sendConditional({ headers: {} }, res.reply as never, { ok: true }, { match: "plain" });
    expect(produced).toEqual({ ok: true });
  });
});
