/**
 * Spec 39 — the device-only "external books" surface. Tests pin the
 * component contract before the component exists.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExternalBooks, AddExternalBookDialog } from "./ExternalBooks";
import type { ExternalItem } from "../local/db";

const AUDIBLE_ITEM: ExternalItem = {
  id: "uuid-audible",
  store: "audible",
  externalId: "B00S2LTCQK",
  httpsUrl: "https://www.audible.com/pd/The-Count-of-Monte-Cristo/B00S2LTCQK",
  title: "the count of monte cristo",
  author: "Alexandre Dumas",
  narrator: null,
  coverUrl: null,
  createdAt: "2026-11-13T10:00:00.000Z",
};

const LIBROFM_ITEM: ExternalItem = {
  id: "uuid-librofm",
  store: "librofm",
  externalId: "9781705085059",
  httpsUrl: "https://libro.fm/audiobooks/9781705085059-fourth-wing",
  title: "fourth wing",
  author: null,
  narrator: null,
  coverUrl: null,
  createdAt: "2026-11-13T10:01:00.000Z",
};

describe("ExternalBooks", () => {
  it("renders nothing when there are no external books", () => {
    const { container } = render(
      <ExternalBooks role="member" items={[]} onLaunch={() => {}} onRemove={async () => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a card per item with the store badge and title", () => {
    render(
      <ExternalBooks
        role="member"
        items={[AUDIBLE_ITEM, LIBROFM_ITEM]}
        onLaunch={() => {}}
        onRemove={async () => {}}
      />,
    );
    expect(screen.getByText("From your other apps")).toBeInTheDocument();
    expect(screen.getByText("the count of monte cristo")).toBeInTheDocument();
    expect(screen.getByText("Alexandre Dumas")).toBeInTheDocument();
    expect(screen.getByText("Audible")).toBeInTheDocument();
    expect(screen.getByText("Libro.fm")).toBeInTheDocument();
  });

  it("child profiles get nothing at all", () => {
    const { container } = render(
      <ExternalBooks role="child" items={[AUDIBLE_ITEM]} onLaunch={() => {}} onRemove={async () => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("tapping a card launches the store URL for that item", async () => {
    const user = userEvent.setup();
    const onLaunch = vi.fn();
    render(<ExternalBooks role="admin" items={[AUDIBLE_ITEM]} onLaunch={onLaunch} onRemove={async () => {}} />);
    await user.click(screen.getByRole("button", { name: /open the count of monte cristo in audible/i }));
    expect(onLaunch).toHaveBeenCalledWith(AUDIBLE_ITEM);
  });

  it("remove is two-step: first tap asks, only the second removes", async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn(async () => undefined);
    render(
      <ExternalBooks role="member" items={[AUDIBLE_ITEM]} onLaunch={() => {}} onRemove={onRemove} />,
    );
    const remove = screen.getByRole("button", { name: /remove the count of monte cristo/i });
    await user.click(remove);
    expect(onRemove).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /remove this book/i }));
    expect(onRemove).toHaveBeenCalledWith(AUDIBLE_ITEM.id);
  });

  it("has no playback, progress or wishlist affordances anywhere", () => {
    render(
      <ExternalBooks
        role="member"
        items={[AUDIBLE_ITEM]}
        onLaunch={() => {}}
        onRemove={async () => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: /play|resume|listen|progress|wishlist|favourite/i })).toBeNull();
  });
});

describe("AddExternalBookDialog", () => {
  const validUrl = "https://www.audible.com/pd/The-Count-of-Monte-Cristo/B00S2LTCQK";

  it("previews the store and the URL-derived book name for a valid link", async () => {
    const user = userEvent.setup();
    render(<AddExternalBookDialog open onClose={() => {}} onAdd={vi.fn()} />);
    await user.type(screen.getByPlaceholderText(/paste the book/i), validUrl);
    expect(screen.getByText("Audible")).toBeInTheDocument();
    expect(screen.getByDisplayValue("the count of monte cristo")).toBeInTheDocument();
  });

  it("shows the unsupported message for a non-store link and adds nothing", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(<AddExternalBookDialog open onClose={() => {}} onAdd={onAdd} />);
    await user.type(screen.getByPlaceholderText(/paste the book/i), "https://example.com/book");
    expect(screen.getByText(/couldn't recognise that link/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add to my list/i })).toBeDisabled();
  });

  it("submits the parsed link with the edited title and author", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn(async () => ({ ok: true as const, item: AUDIBLE_ITEM, created: true }));
    render(<AddExternalBookDialog open onClose={() => {}} onAdd={onAdd} />);
    await user.type(screen.getByPlaceholderText(/paste the book/i), validUrl);
    await user.clear(screen.getByDisplayValue("the count of monte cristo"));
    await user.type(screen.getByLabelText(/book name/i), "The Count of Monte Cristo");
    await user.type(screen.getByLabelText(/author/i), "Alexandre Dumas");
    await user.click(screen.getByRole("button", { name: /add to my list/i }));
    expect(onAdd).toHaveBeenCalledWith(validUrl, {
      title: "The Count of Monte Cristo",
      author: "Alexandre Dumas",
    });
  });

  it("child profiles cannot see or use the dialog", () => {
    const { container } = render(
      <AddExternalBookDialog open role="child" onClose={() => {}} onAdd={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
