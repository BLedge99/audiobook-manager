import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ServerLibrary } from "./ServerLibrary";
import type { Audiobook } from "../types";

/**
 * Spec 27 — the "Server library" tab.
 *
 * The tab answers a different question from the Library tab: *what else is on
 * the server?* The thing worth protecting is that it says which books are
 * already in the profile's library, and that adding one is a single tap.
 */

function book(id: number, title: string, inLibrary: boolean): Audiobook {
  return {
    id,
    title,
    author: "An Author",
    fileFormat: "mp3",
    duration: 3600,
    tracks: [],
    inLibrary,
  } as unknown as Audiobook;
}

function renderTab(overrides: Partial<React.ComponentProps<typeof ServerLibrary>> = {}) {
  const onLoad = vi.fn();
  const onAdd = vi.fn(async () => undefined);
  const onRemove = vi.fn(async () => undefined);
  render(
    <ServerLibrary
      books={[book(1, "Already mine", true), book(2, "Not mine yet", false)]}
      loading={false}
      onLoad={onLoad}
      onAdd={onAdd}
      onRemove={onRemove}
      {...overrides}
    />,
  );
  return { onLoad, onAdd, onRemove };
}

beforeEach(() => {
  window.localStorage.setItem("profileId", "1");
});

describe("the Server library tab", () => {
  it("lists every book the server has", () => {
    renderTab();
    expect(screen.getByText("Already mine")).toBeInTheDocument();
    expect(screen.getByText("Not mine yet")).toBeInTheDocument();
  });

  it("offers a way to take a book out of the library, and a way to add one", () => {
    // A list that shows which books you have has to let you change that, or it
    // is a dead end. The household asked for exactly this.
    renderTab();
    const remove = screen.getByRole("button", { name: /remove from my library/i });
    expect(remove).toBeInTheDocument();
    // The book that is not in the library gets an Add button instead.
    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
  });

  it("removes a book from the library", async () => {
    const user = userEvent.setup();
    const { onRemove } = renderTab();
    await user.click(screen.getByRole("button", { name: /remove from my library/i }));
    // No download, so nothing irreversible is at stake and it goes straight
    // out -- no question asked.
    await waitFor(() => expect(onRemove).toHaveBeenCalledWith(1));
  });

  it("asks about the download before removing a downloaded book", async () => {
    const user = userEvent.setup();
    const { onRemove } = renderTab({ isDownloaded: () => true });
    await user.click(screen.getByRole("button", { name: /remove from my library/i }));

    // The question names the consequence and offers both answers.
    expect(screen.getByText(/Delete the download as well/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete it" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /keep the download/i })).toBeInTheDocument();
    // Nothing has been removed yet -- the question is still open.
    expect(onRemove).not.toHaveBeenCalled();

    // `fireEvent`, not `user.click`: answering the question removes the
    // panel, so the button that was clicked leaves the DOM mid-click.
    // `userEvent` then waits for a detached element for ever, and -- worse --
    // leaves the document's pointer state dirty, so every *later* click in the
    // file hangs too. The rule: a click that removes its own button is a
    // `fireEvent`.
    fireEvent.click(screen.getByRole("button", { name: /keep the download/i }));
    await waitFor(() => expect(onRemove).toHaveBeenCalledWith(1));
  });

  it("deletes the download too when that is the answer", async () => {
    const user = userEvent.setup();
    const onDeleteDownload = vi.fn(async () => ({ failed: [] }));
    const { onRemove } = renderTab({ isDownloaded: () => true, onDeleteDownload });
    await user.click(screen.getByRole("button", { name: /remove from my library/i }));
    // `fireEvent`, not `user.click` -- see the note above: answering the
    // question removes the panel, and a `userEvent` click on a button that
    // removes itself never finishes.
    fireEvent.click(screen.getByRole("button", { name: "Delete it" }));

    await waitFor(() => expect(onDeleteDownload).toHaveBeenCalledWith(1));
    expect(onRemove).toHaveBeenCalledWith(1);
  });

  it("says how many of the server's books are in your library", () => {
    renderTab();
    expect(screen.getByText("1 of 2 in your library")).toBeInTheDocument();
  });

  it("adds a book when the button is used", async () => {
    // `fireEvent`, not `user.click`: the Add button disables itself while the
    // request is in flight, and `userEvent` does not recover cleanly from a
    // button that goes disabled under the pointer -- it leaves the document's
    // pointer state dirty and every later click in the file hangs. A click that
    // changes the button's own disabled state is a `fireEvent`.
    const { onAdd } = renderTab();
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onAdd).toHaveBeenCalledWith(2);
  });

  it("loads the server library when it opens", () => {
    const { onLoad } = renderTab();
    expect(onLoad).toHaveBeenCalled();
  });

  it("says so when the server has no books at all", () => {
    renderTab({ books: [] });
    expect(screen.getByText(/No audiobooks have been added yet/)).toBeInTheDocument();
    // The empty state names the next action rather than just reporting.
    expect(screen.getByText(/Add a folder/)).toBeInTheDocument();
  });

  it("shows an error when the server library cannot be read", () => {
    renderTab({ error: "Could not reach the server." });
    expect(screen.getByRole("alert")).toHaveTextContent("Could not reach the server.");
  });

  it("reports a failure to add, rather than swallowing it", async () => {
    renderTab({ onAdd: vi.fn(async () => { throw new Error("The server said no."); }) });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("The server said no."));
  });
});
