export interface ConfigField {
  type: string;
  label: string;
  description?: string;
  default?: any;
  enum?: string[];
  options?: Array<{ label: string; value: string }>;
  transform?: (value: any) => any;
}

/**
 * Service requirement definition for a plugin
 */
export interface ServiceRequirement {
  /**
   * List of methods required from this service
   */
  methods?: string[];
  
  /**
   * Minimum required version of the service
   */
  version?: string;
}


export interface GridItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  pluginId: string;
  args?: Record<string, any>;
}
