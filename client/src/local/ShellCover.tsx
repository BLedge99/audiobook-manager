/**
 * A cover read through tinted acrylic. (Spec 42, phase 8 — moved from
 * `ui/primitives.tsx`, where it made the design system reach into local cover
 * state and server resolution, so the primitives were no longer a leaf.)
 *
 * The art is never simply scaled: the tint sits over it and the plastic gloss
 * sits over the tint, so the cover reads as being *inside* the shell. `alt` is
 * left empty on purpose -- the title is always set as text next to it, so a
 * screen reader hears the title once rather than twice.
 *
 * The bytes come from the device cover cache (spec 15b feature 1) rather than
 * from a live `<img src>`. Every surface in the app now resolves covers the same
 * way, so a cover that has been seen stays seen, and a fetch that fails shows
 * the placeholder instead of a half-painted image.
 */
import { type CSSProperties } from "react";
import { CoverImage, bookCoverKey } from "./CoverImage";
import { shelfScopeOf } from "../lib/api";
import { cn } from "../ui/primitives";

/** Shell tints, picked deterministically so a given book always looks the same. */
const SHELL_TINTS = ["var(--cobalt)", "var(--mint)", "var(--tan)", "var(--rasp)", "#7c5cff", "#2aa3c9"];

function shellTint(seed: number) {
  const picked = SHELL_TINTS[Math.abs(Math.round(seed * 2654435761)) % SHELL_TINTS.length];
  return { "--tint-hue": picked } as CSSProperties;
}

export function ShellCover({
  bookId,
  serverId,
  className,
  ratio = "2 / 3",
}: {
  bookId: number;
  /** Which server the book lives on; defaults to the connected one. */
  serverId?: string;
  className?: string;
  ratio?: string;
}) {
  return (
    <span className={cn("shell-art block", className)} style={{ aspectRatio: ratio, ...shellTint(bookId) }}>
      {/*
        No `display: contents` here. `CoverImage` observes its own wrapper with
        an IntersectionObserver to decide when to start fetching, and an element
        with `display: contents` has no box at all -- so it never intersects and
        no cover is ever fetched. The shell's own CSS fills this wrapper.
      */}
      <CoverImage cacheKey={bookCoverKey(bookId, shelfScopeOf(serverId))} />
      <span className="shell-art__tint" aria-hidden="true" />
      <span className="capsule__gloss" aria-hidden="true" />
    </span>
  );
}
