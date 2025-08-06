// Legacy Adapters for Unified Dynamic Page Renderer
// These adapters provide backward compatibility during migration

export { LegacyModuleAdapter } from './LegacyModuleAdapter';
export type { LegacyModuleAdapterProps, LegacyAdapterConfig } from './LegacyModuleAdapter';

// Re-export for convenience
export { LegacyModuleAdapter as LegacyPluginModuleRenderer } from './LegacyModuleAdapter';

// Plugin Studio Adapter
export { PluginStudioAdapter } from './PluginStudioAdapter';
export type { PluginStudioAdapterProps } from './PluginStudioAdapter';