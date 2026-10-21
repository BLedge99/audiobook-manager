import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ServerLibrary } from "./ServerLibrary";
import type { Audiobook } from "../types";

/**
 * Every click in this file is `fireEvent`, never `userEvent`.
 *
 * `userEvent` plays a real pointer sequence, and its state lives on the
 * `document`, so it is shared between tests. When a click removes the element
 * it pressed -- which these do, because answering the question closes the
 * panel -- `userEvent` waits for the detached element for ever and leaves the
 * pointer state dirty, so every *later* click in the file hangs too. The
 * symptom is a test that passes alone and times out in the suite, which is a
 * hard thing to see.
 *
 * These assertions are about callbacks, not about pointer behaviour, so
 * `fireEvent` is the right tool anyway.
 */

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

  it("opens the book when its title is tapped", async () => {
    // The household tapped a book in this tab and nothing happened. A row you
    // cannot open is a dead end, and this tab lists the same books as every
    // other surface, so it should behave like them.
    const onOpen = vi.fn();
    renderTab({ onOpen });
    fireEvent.click(screen.getByRole("button", { name: "Already mine" }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 1, title: "Already mine" }));
  });

  it("removes a book from the library", async () => {
    const { onRemove } = renderTab();
    fireEvent.click(screen.getByRole("button", { name: /remove from my library/i }));
    // No download, so nothing irreversible is at stake and it goes straight
    // out -- no question asked.
    await waitFor(() => expect(onRemove).toHaveBeenCalledWith(1));
  });

  it("asks about the download before removing a downloaded book", async () => {
    const { onRemove } = renderTab({ isDownloaded: () => true });
    fireEvent.click(screen.getByRole("button", { name: /remove from my library/i }));

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
    const onDeleteDownload = vi.fn(async () => ({ failed: [] }));
    const { onRemove } = renderTab({ isDownloaded: () => true, onDeleteDownload });
    fireEvent.click(screen.getByRole("button", { name: /remove from my library/i }));
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

  it("does not claim the household has no books when the shelf could not be read", () => {
    // "No audiobooks have been added yet" is the empty shelf talking, and the
    // shelf was never read. Saying it after a failed fetch is a lie -- and it
    // is the lie that made the tab look broken offline.
    renderTab({ books: [], error: "Could not reach the server." });
    expect(screen.queryByText(/No audiobooks have been added yet/)).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Could not reach the server.");
  });
});

/**
 * Spec 27, offline.
 *
 * The shelf belongs to the server, so offline there is nothing to add. But the
 * tab does not have to be dead for that: while the server is out of reach the
 * app's library *is* the books on this device, and taking one of those away
 * needs no server at all. The household asked for exactly this.
 */
describe("the Server library tab, offline", () => {
  const onDevice = [book(9, "Downloaded book", true)];

  it("shows the books on this device rather than an error", () => {
    renderTab({ offline: true, offlineBooks: onDevice, error: "Could not reach the server." });
    expect(screen.getByText("Downloaded book")).toBeInTheDocument();
    // The lie is gone: it does not say the household has no audiobooks.
    expect(screen.queryByText(/No audiobooks have been added yet/)).not.toBeInTheDocument();
  });

  it("lets you take a book away, which needs no server", async () => {
    const onRemoveDevice = vi.fn(async () => ({ failed: [] }));
    renderTab({ offline: true, offlineBooks: onDevice, onRemoveDevice });
    fireEvent.click(screen.getByRole("button", { name: /remove from device: downloaded book/i }));
    await waitFor(() => expect(onRemoveDevice).toHaveBeenCalledWith(9));
  });

  it("does not offer to add anything, because the server is out of reach", () => {
    renderTab({ offline: true, offlineBooks: onDevice });
    expect(screen.queryByRole("button", { name: "Add" })).not.toBeInTheDocument();
  });

  it("does not try to fetch a shelf it cannot reach", () => {
    // A request that is known to fail is a request that should not be made.
    const { onLoad } = renderTab({ offline: true, offlineBooks: onDevice });
    expect(onLoad).not.toHaveBeenCalled();
  });

  it("says why there is nothing to add", () => {
    renderTab({ offline: true, offlineBooks: onDevice });
    expect(screen.getByText(/nothing new to add/i)).toBeInTheDocument();
  });

  it("still opens the book when its title is tapped", () => {
    const onOpen = vi.fn();
    renderTab({ offline: true, offlineBooks: onDevice, onOpen });
    fireEvent.click(screen.getByRole("button", { name: "Downloaded book" }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 9 }));
  });

  it("reports a failure to remove, rather than swallowing it", async () => {
    renderTab({
      offline: true,
      offlineBooks: onDevice,
      onRemoveDevice: vi.fn(async () => { throw new Error("The file is in use."); }),
    });
    fireEvent.click(screen.getByRole("button", { name: /remove from device: downloaded book/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("The file is in use."));
  });
});
