import type { FastifyReply } from "fastify";

/**
 * The API error contract (ADR 015).
 *
 * A failed request answers with a stable machine code, plus the values the
 * sentence needs when it has any. It never answers with the sentence itself:
 * the client owns every word (`specs/15b-post-testing-polish.md`, feature 7b).
 *
 * Two things follow from that, and both are the point:
 *
 *  - There is one copy catalog. A sentence the server wrote was invisible to
 *    `npm run check:copy` and to `copy.test.ts`, so it drifted and no rule
 *    could reach it.
 *  - Error bodies stop carrying internals. `error.message` used to be echoed
 *    on any 4xx, which included filesystem paths and Prisma wording.
 *
 * Adding a code is additive: the client renders an unknown code with its
 * generic "something went wrong" sentence, so an older client never shows
 * `undefined` against a newer server.
 */
export type ApiErrorCode =
  | "auth_required"
  | "password_must_be_string"
  | "incorrect_password"
  | "not_found"
  | "profile_required"
  | "profile_name_required"
  | "profile_name_taken"
  | "invalid_id"
  | "audiobook_not_found"
  | "library_path_required"
  | "library_path_inaccessible"
  | "library_root_required"
  | "cover_not_found"
  | "forbidden"
  | "audio_file_not_found"
  | "invalid_track_id"
  | "invalid_track_number"
  | "track_not_found"
  | "candidate_not_found"
  | "genre_slug_taken"
  | "parent_genre_not_found"
  | "genre_not_found"
  | "catch_all_genre_undeletable"
  | "unknown_genre_id"
  | "unknown_tag_id"
  | "tag_name_rejected"
  | "tag_merge_failed"
  | "tag_not_found"
  | "wishlist_item_not_found"
  | "positions_required"
  | "request_invalid"
  | "internal_error";

/**
 * Values a client splices into its own sentence.
 *
 * `reason` is the tag validator's own short code (`"too-long"`,
 * `"same-tag"`, ...), not prose. It travels as data so the client decides how
 * to say it.
 */
export interface ApiErrorParams {
  reason?: string;
}

export interface ApiErrorBody {
  code: ApiErrorCode;
  params?: ApiErrorParams;
}

/**
 * Send a typed failure. The only place the response shape is defined, so
 * changing the envelope is a one-file change.
 */
export function fail(
  reply: FastifyReply,
  status: number,
  code: ApiErrorCode,
  params?: ApiErrorParams,
): FastifyReply {
  return reply.code(status).send((params ? { code, params } : { code }) satisfies ApiErrorBody);
}
