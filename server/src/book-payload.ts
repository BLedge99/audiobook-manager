/**
 * The single book payload shape (spec 37, step 7.4).
 *
 * The library listing, the server-library listing, the book detail and the
 * favourites list all return a book. Before this module they built three
 * slightly different shapes by hand — the `contributors` array differed
 * between them. This is the one builder.
 */

/** Strip server-side filesystem paths before a payload leaves the server. */
export function publicMediaItem<T extends Record<string, unknown>>(item: T): Omit<T, "filePath" | "coverImagePath"> {
  const { filePath: _filePath, coverImagePath: _cover, ...rest } = item;
  return rest as Omit<T, "filePath" | "coverImagePath">;
}

interface PayloadContributorLink {
  contributor: { id: number; name: string; role: string };
}

interface PayloadGenreLink {
  source: string;
  genre: { id: number; slug: string; name: string; parentId: number | null };
}

interface PayloadTagLink {
  tag: { id: number; name: string };
}

/**
 * Shape of a media item with its join rows included. Missing relations are
 * tolerated so callers with leaner queries still get one shape.
 */
export interface BookPayloadSource extends Record<string, unknown> {
  id: number;
  tracks?: Array<Record<string, unknown> & { filePath?: string }>;
  genres?: PayloadGenreLink[];
  customTags?: PayloadTagLink[];
  contributors?: PayloadContributorLink[];
}

/** The one book shape. `tracks` are included with paths stripped. */
export function publicBookPayload(item: BookPayloadSource): Record<string, unknown> {
  const tracks = Array.isArray(item.tracks)
    ? item.tracks.map((track) => {
        if ("filePath" in track) {
          const { filePath: _trackPath, ...rest } = track;
          return rest;
        }
        return track;
      })
    : [];

  return {
    ...publicMediaItem({ ...item, tracks }),
    genres: (item.genres ?? []).map((link) => ({
      id: link.genre.id,
      slug: link.genre.slug,
      name: link.genre.name,
      parentId: link.genre.parentId,
      source: link.source,
    })),
    customTags: (item.customTags ?? []).map((link) => ({
      id: link.tag.id,
      name: link.tag.name,
    })),
    contributors: (item.contributors ?? []).map((link) => ({
      id: link.contributor.id,
      name: link.contributor.name,
      role: link.contributor.role,
    })),
  };
}
