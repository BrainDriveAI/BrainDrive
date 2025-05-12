import { AbstractBaseService, ServiceCapability } from './base/BaseService';
import { pageService } from './pageService';
import { v4 as uuidv4 } from 'uuid';

export class UserPageInitService extends AbstractBaseService {
  constructor() {
    const capabilities: ServiceCapability[] = [
      {
        name: 'user.page.init',
        description: 'Initialize default pages and routes for new users',
        version: '1.0.0'
      }
    ];

    super('userPageInit', { major: 1, minor: 0, patch: 0 }, capabilities);
  }

  async initialize(): Promise<void> {
    // No initialization needed
    console.log('UserPageInitService initialized');
  }

  async destroy(): Promise<void> {
    // No cleanup needed
  }

  /**
   * Initialize default pages and routes for a new user
   * @param userId The ID of the user to initialize pages for
   */
  async initializeUserPages(userId: string): Promise<void> {
    try {
      console.log(`Initializing default pages for user: ${userId}`);
      
      // Check if the user already has a dashboard page
      const existingPages = await pageService.getPages();
      const dashboardPage = existingPages.pages.find(page => 
        page.name === 'dashboard' && page.creator_id === userId
      );
      
      if (dashboardPage) {
        console.log('User already has a dashboard page, skipping initialization');
        return;
      }
      
      // Create the dashboard page
      await this.createDashboardPage(userId);
      
      // Note: Default routes are now handled by UserNavigationInitService
      
      console.log('Default pages and routes initialized successfully');
    } catch (error) {
      console.error('Error initializing default pages:', error);
    }
  }

  /**
   * Create the default dashboard page for a new user
   * @param userId The ID of the user to create the dashboard for
   */
  private async createDashboardPage(userId: string): Promise<void> {
    try {
      const dashboardConfig = this.getDashboardPageConfig();
      
      // Create the dashboard page
      const dashboardPage = await pageService.createPage({
        name: 'dashboard',
        description: 'Your BrainDrive Dashboard',
        is_parent_page: false,
        parent_type: 'dashboard', // Associate with the dashboard core route
        is_published: true,
        creator_id: userId,
        content: JSON.stringify(dashboardConfig),
        modules: dashboardConfig.modules,
        layouts: dashboardConfig.layouts
      });
      
      console.log(`Dashboard page created with ID: ${dashboardPage.id}`);
    } catch (error) {
      console.error('Error creating dashboard page:', error);
      throw error;
    }
  }


  /**
   * Get the configuration for the dashboard page
   * @returns The dashboard page configuration
   */
  private getDashboardPageConfig(): any {
    // Generate a new UUID for the page
    const pageId = uuidv4();
    
    // Generate unique IDs for the components
    const component1Id = `pluginA-component1-${Date.now()}`;
    const component2Id = `pluginA-component2-${Date.now() + 10000}`; // Add offset to ensure uniqueness
    
    return {
      id: pageId,
      name: 'dashboard',
      description: '',
      layouts: {
        desktop: [
          {
            moduleUniqueId: component1Id,
            i: component1Id,
            x: 4,
            y: 0,
            w: 8,
            h: 9,
            minW: 2,
            minH: 2
          },
          {
            moduleUniqueId: component2Id,
            i: component2Id,
            x: 0,
            y: 0,
            w: 4,
            h: 3,
            minW: 2,
            minH: 2
          }
        ],
        tablet: [
          {
            moduleUniqueId: component1Id,
            i: component1Id,
            x: 0,
            y: 0,
            w: 3,
            h: 2,
            minW: 2,
            minH: 2
          },
          {
            moduleUniqueId: component2Id,
            i: component2Id,
            x: 0,
            y: 2,
            w: 3,
            h: 2,
            minW: 2,
            minH: 2
          }
        ],
        mobile: [
          {
            moduleUniqueId: component1Id,
            i: component1Id,
            x: 0,
            y: 0,
            w: 3,
            h: 2,
            minW: 2,
            minH: 2
          },
          {
            moduleUniqueId: component2Id,
            i: component2Id,
            x: 0,
            y: 2,
            w: 3,
            h: 2,
            minW: 2,
            minH: 2
          }
        ]
      },
      modules: {
        [component1Id]: {
          pluginId: 'pluginA',
          moduleId: 'component1',
          moduleName: 'Component',
          config: {
            displayName: 'Basic Component',
            description: 'A simple component from Plugin A',
            category: 'Basic',
            tags: [
              'basic',
              'demo'
            ],
            type: 'frontend',
            priority: 1,
            dependencies: []
          }
        },
        [component2Id]: {
          pluginId: 'pluginA',
          moduleId: 'component2',
          moduleName: 'Component2',
          config: {
            displayName: 'Advanced Component',
            description: 'A more advanced component with additional features',
            category: 'Advanced',
            tags: [
              'advanced',
              'interactive'
            ],
            type: 'frontend',
            priority: 2,
            dependencies: []
          }
        }
      }
    };
  }
}

// Create a singleton instance
export const userPageInitService = new UserPageInitService();
