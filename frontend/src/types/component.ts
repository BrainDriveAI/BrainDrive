/**
 * Represents a component in the system
 */
export interface Component {
  /**
   * Unique identifier for the component
   */
  id: string;
  
  /**
   * Display name shown in the UI
   */
  name: string;
  
  /**
   * Unique component identifier used for lookups
   */
  component_id: string;
  
  /**
   * Description of the component
   */
  description?: string;
  
  /**
   * Icon identifier for the component (Material UI icon name)
   */
  icon?: string;
  
  /**
   * Whether this is a system component that cannot be deleted
   */
  is_system?: boolean;
  
  /**
   * Creation timestamp
   */
  created_at?: string;
  
  /**
   * Last update timestamp
   */
  updated_at?: string;
}
