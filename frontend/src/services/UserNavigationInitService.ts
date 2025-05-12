import { AbstractBaseService, ServiceCapability } from './base/BaseService';
import { navigationService } from './navigationService';
import { componentService } from './componentService';

export class UserNavigationInitService extends AbstractBaseService {
  constructor() {
    const capabilities: ServiceCapability[] = [
      {
        name: 'user.navigation.init',
        description: 'Initialize system routes and components for new users',
        version: '1.0.0'
      }
    ];

    super('userNavigationInit', { major: 1, minor: 0, patch: 0 }, capabilities);
  }

  async initialize(): Promise<void> {
    // No initialization needed
    // console.log('UserNavigationInitService initialized');
  }

  async destroy(): Promise<void> {
    // No cleanup needed
  }

  /**
   * Initialize system routes and components for a new user
   * @param userId The ID of the user to initialize navigation for
   */
  async initializeUserNavigation(userId: string): Promise<void> {
    try {
      // console.log(`Initializing system routes and components for user: ${userId}`);
      
      // Ensure system components exist
      await this.ensureSystemComponents();
      
      // Ensure system routes exist
      await this.ensureSystemRoutes(userId);
      
      // console.log('System routes and components initialized successfully');
    } catch (error) {
      console.error('Error initializing system routes and components:', error);
    }
  }

  /**
   * Ensure that system components exist
   */
  private async ensureSystemComponents(): Promise<void> {
    try {
      // Get existing components
      const existingComponents = await componentService.getComponents();
      
      // Define system components
      const systemComponents = [
        {
          name: 'Dashboard',
          component_id: 'dashboard',
          description: 'Your BrainDrive Dashboard',
          icon: 'Dashboard',
          is_system: true
        },
        {
          name: 'Plugin Studio',
          component_id: 'plugin-studio',
          description: 'BrainDrive Studio for creating and editing pages',
          icon: 'Extension',
          is_system: true
        },
        {
          name: 'Settings',
          component_id: 'settings',
          description: 'System settings and configuration',
          icon: 'Settings',
          is_system: true
        },
        {
          name: 'Plugin Manager',
          component_id: 'plugin-manager',
          description: 'Manage plugins and modules',
          icon: 'Extension',
          is_system: true
        }
      ];
      
      // Create any missing components
      for (const component of systemComponents) {
        const existingComponent = existingComponents.find(c => c.component_id === component.component_id);
        
        if (!existingComponent) {
          // console.log(`Creating system component: ${component.name}`);
          await componentService.createComponent(component);
        }
      }
    } catch (error) {
      console.error('Error ensuring system components:', error);
      throw error;
    }
  }

  /**
   * Ensure that system routes exist
   * @param userId The ID of the user to create routes for
   */
  private async ensureSystemRoutes(userId: string): Promise<void> {
    try {
      // Get existing routes
      const existingRoutes = await navigationService.getNavigationRoutes();
      
      // Define system routes
      const systemRoutes = [
        {
          name: 'Your BrainDrive',
          route: 'dashboard',
          icon: 'Dashboard',
          description: 'Your BrainDrive Dashboard',
          order: 1,
          is_visible: true,
          is_system_route: true,
          default_component_id: 'dashboard',
          can_change_default: false,
          creator_id: userId
        },
        {
          name: 'BrainDrive Studio',
          route: 'plugin-studio',
          icon: 'Extension',
          description: 'BrainDrive Studio for creating and editing pages',
          order: 2,
          is_visible: true,
          is_system_route: true,
          default_component_id: 'plugin-studio',
          can_change_default: false,
          creator_id: userId
        },
        {
          name: 'Settings',
          route: 'settings',
          icon: 'Settings',
          description: 'System settings and configuration',
          order: 3,
          is_visible: true,
          is_system_route: true,
          default_component_id: 'settings',
          can_change_default: false,
          creator_id: userId
        },
        {
          name: 'Plugin Manager',
          route: 'plugin-manager',
          icon: 'Extension',
          description: 'Manage plugins and modules',
          order: 4,
          is_visible: true,
          is_system_route: true,
          default_component_id: 'plugin-manager',
          can_change_default: true,
          creator_id: userId
        }
      ];
      
      // Create any missing routes
      for (const route of systemRoutes) {
        const existingRoute = existingRoutes.find(r => r.route === route.route);
        
        if (!existingRoute) {
          // console.log(`Creating system route: ${route.name}`);
          await navigationService.createNavigationRoute(route);
        } else if (existingRoute.default_component_id !== route.default_component_id) {
          // Update the route if the default_component_id is different
          // console.log(`Updating system route: ${route.name}`);
          await navigationService.updateNavigationRoute(existingRoute.id, {
            default_component_id: route.default_component_id,
            is_system_route: true
          });
        }
      }
    } catch (error) {
      console.error('Error ensuring system routes:', error);
      throw error;
    }
  }
}

// Create a singleton instance
export const userNavigationInitService = new UserNavigationInitService();