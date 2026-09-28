import {
  listMcpTools,
  mapMcpToolToDefinition,
  normalizeLegacyCallResult,
} from "../client.js";

export const BOUNDED_LEGACY_MCP_PROFILE = {
  era: "bounded_legacy_stateful",
  protocolVersion: "2025-11-25",
  methods: ["tools/list", "tools/call"],
  apps: false,
} as const;

/**
 * Fixed first-party services retain their established SDK v1 connection,
 * request-context, approval, error, and lossy model-output boundary. They are
 * deliberately not registered in the installed-app connection manager.
 */
export const listLegacyMcpTools = listMcpTools;
export const mapLegacyMcpToolToDefinition = mapMcpToolToDefinition;
export { normalizeLegacyCallResult };
