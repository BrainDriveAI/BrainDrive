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
      console.log(`🔧 UserNavigationInitService: Skipping frontend route creation - using backend hierarchical navigation for user: ${userId}`);
      
      // Skip system components and routes creation - let backend handle it
      // await this.ensureSystemComponents();
      // await this.ensureSystemRoutes(userId);
      
      console.log('🔧 UserNavigationInitService: Initialization completed (backend-managed)');
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
      // Skip system route creation - now handled by backend navigation initializer
      // The backend creates hierarchical navigation routes during user registration
      console.log('Skipping frontend system route creation - handled by backend initializer');
      
      // Note: System routes are now created by the backend navigation initializer
      // during user registration with proper hierarchical structure
    } catch (error) {
      console.error('Error ensuring system routes:', error);
      throw error;
    }
  }
}

// Create a singleton instance
export const userNavigationInitService = new UserNavigationInitService();