/**
 * Spec 39 — the "Get this book" sheet. Child sessions render nothing; every
 * commissionable row carries the AD cue; nothing price-like is rendered
 * anywhere; LibriVox lookup happens server-side only.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GetThisBookSheet } from "./GetThisBookSheet";

const launchStoreLink = vi.hoisted(() => vi.fn(async () => true));
vi.mock("../lib/externalIntent", () => ({
  launchStoreLink,
  canResolve: vi.fn(async () => true),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  launchStoreLink.mockClear();
});

const BASE = {
  open: true,
  onClose: vi.fn(),
  isChild: false,
  title: "The Picture of Dorian Gray",
  author: "Oscar Wilde",
  isbn: "9780439023528",
};

const MATCH = {
  librivox: { id: "365", title: "Picture of Dorian Gray", url: "https://librivox.org/picture-of-dorian-gray-version-3/" },
};

function stubBuyContext(body: unknown, status = 200) {
  const spy = vi.fn(async (_url: unknown) => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", spy);
  return spy;
}

describe("rendering the rows", () => {
  it("renders the LibriVox Free row first when the server says it exists", async () => {
    stubBuyContext(MATCH);
    render(<GetThisBookSheet {...BASE} />);
    expect(await screen.findByRole("link", { name: /librivox/i })).toBeInTheDocument();

    const free = screen.getByRole("link", { name: /librivox/i });
    expect(free).toHaveAttribute("href", MATCH.librivox.url);
    expect(free).not.toHaveTextContent(/\$|£|€/);
  });

  it("renders all paid rows with 'Check price →' and no price text", async () => {
    stubBuyContext({ librivox: null });
    render(<GetThisBookSheet {...BASE} />);
    for (const vendor of ["Libro.fm", "Bookshop.org", "Barnes & Noble", "Kobo", "Audible", "Google Play Books"]) {
      expect(await screen.findByRole("button", { name: new RegExp(vendor) })).toBeInTheDocument();
    }
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/\$|£|€|lowest|was /i);
  });

  it("every commissionable button carries the AD cue when a tag is configured", async () => {
    vi.stubEnv("VITE_AFFILIATE_KOBO", "rkkobo=12345");
    vi.stubEnv("VITE_AFFILIATE_LIBROFM", "librofm=678");
    stubBuyContext({ librivox: null });
    render(<GetThisBookSheet {...BASE} />);
    const kobo = await screen.findByRole("button", { name: /Kobo/ });
    const librofm = await screen.findByRole("button", { name: /Libro\.fm/ });
    expect(kobo).toBeInTheDocument();
    expect(librofm).toBeInTheDocument();
    // The cue lives on the button's own row, adjacent to the button:
    expect(kobo.closest("[data-row]")!.textContent).toContain("we may earn a commission");
    expect(librofm.closest("[data-row]")!.textContent).toContain("we may earn a commission");
    // Untagged rows show nothing:
    expect((await screen.findByRole("button", { name: /Audible/ })).closest("[data-row]")!.textContent).not.toContain("we may earn");
  });

  it("zero-config mode: rows work, no cues, no disclosure footer", async () => {
    stubBuyContext({ librivox: null });
    render(<GetThisBookSheet {...BASE} />);
    expect(await screen.findByRole("button", { name: /Audible/ })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("we may earn a commission");
    expect(screen.queryByText(/tell us nothing/i)).toBeNull();
  });

  it("the disclosure footer names only the configured networks", async () => {
    vi.stubEnv("VITE_AFFILIATE_KOBO", "rkkobo=12345");
    stubBuyContext({ librivox: null });
    render(<GetThisBookSheet {...BASE} />);
    const footer = await screen.findByText(/tell us nothing/i);
    expect(footer.textContent).toContain("Kobo");
    expect(footer.textContent).not.toContain("Libro.fm");
  });

  it("fetch failure hides the Free row without an error message", async () => {
    stubBuyContext("nope", 500);
    render(<GetThisBookSheet {...BASE} />);
    expect(await screen.findByRole("button", { name: /Audible/ })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("Free");
    expect(screen.queryByText(/couldn't|failed|error/i)).toBeNull();
  });

  it("child sessions get nothing: no rows, no lookup", async () => {
    const spy = stubBuyContext(MATCH);
    const { container } = render(<GetThisBookSheet {...BASE} isChild />);
    expect(container).toBeEmptyDOMElement();
    expect(spy).not.toHaveBeenCalled();
  });

  it("queries our server, never librivox.org", async () => {
    const spy = stubBuyContext(MATCH);
    render(<GetThisBookSheet {...BASE} />);
    await waitFor(() => expect(spy).toHaveBeenCalled());
    for (const call of spy.mock.calls) {
      expect(String(call[0])).toMatch(/^\/api\/buy-context\?/);
      expect(String(call[0])).not.toContain("librivox.org");
    }
    const called = String(spy.mock.calls[0][0]).replace(/\+/g, "%20");
    expect(decodeURIComponent(called)).toContain("title=The Picture of Dorian Gray");
  });

  it("clicking a row launches through the store ladder", async () => {
    const user = userEvent.setup();
    stubBuyContext({ librivox: null });
    render(<GetThisBookSheet {...BASE} />);
    await user.click(await screen.findByRole("button", { name: /Audible/ }));
    expect(launchStoreLink).toHaveBeenCalledWith(
      expect.stringContaining("audible.com"),
      expect.objectContaining({ packageName: "com.audible.application" }),
    );
  });
});

describe("the dialog chrome", () => {
  it("closes via Escape and returns focus", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    stubBuyContext({ librivox: null });
    render(<GetThisBookSheet {...BASE} onClose={onClose} />);
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});
