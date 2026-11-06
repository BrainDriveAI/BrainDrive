import "fastify";

import type { AuthContext, PaaAuthContext } from "./contracts.js";

declare module "fastify" {
  interface FastifyRequest {
    authContext: AuthContext;
    paaAuthContext: PaaAuthContext;
  }
}
