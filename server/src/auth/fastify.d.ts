import "fastify";
import type { AuthContext } from "./service";

declare module "fastify" {
  interface FastifyRequest {
    /** Set by the onRequest auth hook. Null when auth is disabled or absent. */
    auth: AuthContext | null;
  }
}
