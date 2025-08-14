/**
 * Represents a navigation route in the system with hierarchical support
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
   * @deprecated Use display_order instead for hierarchical navigation
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
  
  // HIERARCHICAL FIELDS
  /**
   * ID of the parent navigation route (null for root level routes)
   */
  parent_id?: string;
  
  /**
   * Order within the parent group (lower numbers appear first)
   */
  display_order?: number;
  
  /**
   * Whether this section can be collapsed/expanded
   */
  is_collapsible?: boolean;
  
  /**
   * Whether this section is currently expanded
   */
  is_expanded?: boolean;
}

/**
 * Navigation route with children for tree structure
 */
export interface NavigationRouteTree extends NavigationRoute {
  /**
   * Child navigation routes
   */
  children?: NavigationRouteTree[];
  
  /**
   * Depth level in the tree (0 = root, 1 = child, etc.)
   */
  depth_level?: number;
}

/**
 * Data for moving a navigation route
 */
export interface NavigationRouteMove {
  /**
   * New parent ID (null to move to root level)
   */
  parent_id?: string;
  
  /**
   * New display order within the parent
   */
  display_order?: number;
}

/**
 * Data for batch updating navigation routes
 */
export interface NavigationRouteBatchUpdate {
  /**
   * ID of the route to update
   */
  id: string;
  
  /**
   * New parent ID
   */
  parent_id?: string;
  
  /**
   * New display order
   */
  display_order?: number;
  
  /**
   * New expanded state
   */
  is_expanded?: boolean;
}

/**
 * Navigation state for managing expanded/collapsed sections
 */
export interface NavigationState {
  /**
   * Set of route IDs that are currently expanded
   */
  expandedRoutes: Set<string>;
  
  /**
   * Set of route IDs that are currently collapsed
   */
  collapsedRoutes: Set<string>;
}
