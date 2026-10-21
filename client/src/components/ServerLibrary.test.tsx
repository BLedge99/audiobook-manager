import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
  render(
    <ServerLibrary
      books={[book(1, "Already mine", true), book(2, "Not mine yet", false)]}
      loading={false}
      onLoad={onLoad}
      onAdd={onAdd}
      {...overrides}
    />,
  );
  return { onLoad, onAdd };
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

  it("marks the books the profile already has", () => {
    renderTab();
    // The mark is a word, not a colour: status colour never travels alone.
    expect(screen.getByText("In your library")).toBeInTheDocument();
    // ...and the book that is not in the library gets an Add button instead.
    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
  });

  it("says how many of the server's books are in your library", () => {
    renderTab();
    expect(screen.getByText("1 of 2 in your library")).toBeInTheDocument();
  });

  it("adds a book when the button is used", async () => {
    const user = userEvent.setup();
    const { onAdd } = renderTab();
    await user.click(screen.getByRole("button", { name: "Add" }));
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
    const user = userEvent.setup();
    renderTab({ onAdd: vi.fn(async () => { throw new Error("The server said no."); }) });
    await user.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("The server said no."));
  });
});
