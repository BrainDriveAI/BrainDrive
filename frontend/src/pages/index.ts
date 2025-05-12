import { GridItem, ModuleDefinition, LayoutItem } from '../types/index';

export type DeviceType = 'mobile' | 'tablet' | 'desktop';
export interface ViewModeState {
  type: DeviceType | 'custom';
}

export interface DeviceBreakpoints {
  tablet?: number;  // Default: 768
  mobile?: number;  // Default: 480
}

export interface Layouts {
  desktop: (GridItem | LayoutItem)[];     // Required base layout
  tablet?: (GridItem | LayoutItem)[];     // Optional tablet-specific layout
  mobile?: (GridItem | LayoutItem)[];     // Optional mobile-specific layout
}

export interface Page {
  id: string;
  name: string;
  description: string;
  layouts: Layouts;
  defaultBreakpoints?: DeviceBreakpoints;
  route?: string;
  route_segment?: string;         // Just this page's segment of the route
  parent_route?: string;
  parent_type?: string;           // Type of parent: 'page', 'dashboard', 'plugin-studio', 'settings'
  is_published?: boolean;
  publish_date?: string;
  backup_date?: string;
  content?: any;
  content_backup?: any;
  creator_id?: string;
  navigation_route_id?: string;
  modules?: Record<string, ModuleDefinition>;
  is_local?: boolean; // Flag to indicate if this is a local page that hasn't been saved to the backend
  
  // Enhanced routing fields for nested routes
  is_parent_page?: boolean;       // Flag indicating if this is a parent page that can have children
  children?: string[];            // Array of child page IDs
  display_in_navigation?: boolean; // Whether to show in navigation menus
  navigation_order?: number;      // Order in navigation menus
  icon?: string;                  // Icon for navigation display
}

// Default breakpoints that will be used if not specified in the page
export const DEFAULT_BREAKPOINTS: Required<DeviceBreakpoints> = {
  mobile: 480,
  tablet: 768,
};

// Helper function to get the appropriate layout based on width
export function getLayoutForWidth(page: Page, width: number): { layout: (GridItem | LayoutItem)[], device: DeviceType } {
  const breakpoints = {
    ...DEFAULT_BREAKPOINTS,
    ...page.defaultBreakpoints,
  };

  // Determine device type based on width
  let device: DeviceType = 'desktop';
  if (width <= breakpoints.mobile) {
    device = 'mobile';
  } else if (width <= breakpoints.tablet) {
    device = 'tablet';
  }

  // Get the most appropriate layout
  let layout: (GridItem | LayoutItem)[];
  if (device === 'mobile' && page.layouts.mobile) {
    layout = page.layouts.mobile;
  } else if (device === 'tablet' && page.layouts.tablet) {
    layout = page.layouts.tablet;
  } else {
    layout = page.layouts.desktop;
  }

  return { layout, device };
}

// Migration function to convert old pages to new format
function migrateLegacyPage(oldPage: { id: string; name: string; description: string; layout: GridItem[] }): Page {
  // Create a modules object from the GridItem array
  const modules: Record<string, ModuleDefinition> = {};
  
  // Convert each GridItem to a ModuleDefinition
  oldPage.layout.forEach(item => {
    const moduleUniqueId = item.i;
    
    // Create a ModuleDefinition from the GridItem
    modules[moduleUniqueId] = {
      pluginId: item.pluginId,
      moduleId: item.args?.moduleId || 'default',
      moduleName: item.args?.moduleName || 'Default',
      config: item.args || {}
    };
  });
  
  // Convert each GridItem to a LayoutItem
  const layoutItems: LayoutItem[] = oldPage.layout.map(item => ({
    moduleUniqueId: item.i,
    i: item.i,
    x: item.x,
    y: item.y,
    w: item.w,
    h: item.h,
    minW: item.minW,
    minH: item.minH
  }));
  
  return {
    ...oldPage,
    layouts: {
      desktop: layoutItems,
      tablet: undefined,
      mobile: undefined,
    },
    modules
  };
}

// Update existing pages to new format
export const pages: Page[] = [

];

// Export page components
export { default as Login } from './Login';
export { default as Dashboard } from './Dashboard';
export { default as ModuleDetailPage } from './ModuleDetailPage';
export { default as PluginManagerPage } from './PluginManagerPage';
export { default as PluginStudioPage } from './PluginStudio';
export { default as Settings } from './Settings';
export { default as SimpleSettings } from './SimpleSettings';
export { default as ProfilePage } from './ProfilePage';
