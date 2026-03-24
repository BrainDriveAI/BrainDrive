import "fastify";

import type { AuthContext } from "./contracts.js";

declare module "fastify" {
  interface FastifyRequest {
    authContext: AuthContext;
  }
}
