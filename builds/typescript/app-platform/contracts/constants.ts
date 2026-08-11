export const APP_CONTRACT_SCHEMA_VERSION = 1 as const;
export const RESUME_DATA_SCHEMA_VERSION = 2 as const;
export const RESUME_INFERENCE_SCHEMA_VERSION = 1 as const;
export const APP_BRIDGE_SCHEMA_VERSION = 1 as const;

export const RESUME_BUILDER_APP_ID = "ai.braindrive.resume-builder" as const;
export const RESUME_BUILDER_PUBLISHER_ID = "ai.braindrive" as const;

export const MCP_MODERN_PROTOCOL_VERSION = "2026-07-28" as const;
export const MCP_LEGACY_PROTOCOL_VERSION = "2025-11-25" as const;
export const MCP_APPS_EXTENSION_ID = "io.modelcontextprotocol/ui" as const;
export const MCP_APPS_EXTENSION_VERSION = "2026-01-26" as const;
export const MCP_APP_MEDIA_TYPE = "text/html;profile=mcp-app" as const;

export const CONTRACT_SIZE_LIMITS = {
  authorityEnvelopeBytes: 262_144,
  bridgeMessageBytes: 65_536,
  resourceBytes: 2_097_152,
  maxArrayItems: 1_000,
  maxStringLength: 131_072,
} as const;

export const FIRST_PACKAGED_DESKTOP_OS = "windows" as const;
