/**
 * Represents a navigation route in the system
 */
export interface NavigationRoute {
  /**
   * Unique identifier for the navigation route
   */
  id: string;
  
  /**
   * Display name shown in the navigation sidebar
   */
  name: string;
  
  /**
   * The route path used in URLs
   */
  route: string;
  
  /**
   * Icon identifier for the route (Material UI icon name)
   */
  icon?: string;
  
  /**
   * Description of the route
   */
  description?: string;
  
  /**
   * Order in which the route appears in navigation (lower numbers appear first)
   */
  order?: number;
  
  /**
   * Whether the route is visible in navigation
   */
  is_visible?: boolean;
  
  /**
   * ID of the user who created the route
   */
  creator_id: string;
  
  /**
   * Whether this is a system route that cannot be deleted
   */
  is_system_route?: boolean;
  
  /**
   * ID of the default component to display for this route
   */
  default_component_id?: string;
  
  /**
   * ID of the default page to display for this route
   */
  default_page_id?: string;
  
  /**
   * Whether the default component/page can be changed
   */
  can_change_default?: boolean;
  
  /**
   * Creation timestamp
   */
  created_at?: string;
  
  /**
   * Last update timestamp
   */
  updated_at?: string;
}
