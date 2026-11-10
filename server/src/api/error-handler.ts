import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { fail } from "../http-errors";

/**
 * The single error handler for the API (ADR 015 error envelope).
 *
 * Extracted from the app module so the envelope contract lives in exactly one
 * place: the typed status + code mapping below, with the human detail kept for
 * the server log only (it used to leak filesystem paths and Prisma wording into
 * 4xx responses; the client renders the code instead).
 */
export function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
  // The detail is for the server log only. This handler used to echo
  // `error.message` on any 4xx, and that included filesystem paths and
  // Prisma wording (spec 11); the client renders the code instead.
  request.log.error(error);
  const candidateStatusCode =
    typeof error === "object" && error !== null && "statusCode" in error
      ? error.statusCode
      : undefined;
  const statusCode =
    typeof candidateStatusCode === "number" && candidateStatusCode >= 400
      ? candidateStatusCode
      : 500;
  return fail(reply, statusCode, statusCode >= 500 ? "internal_error" : "request_invalid");
}
