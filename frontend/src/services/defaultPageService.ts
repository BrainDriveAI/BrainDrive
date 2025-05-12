import { Page } from '../pages';
import { pageService } from './pageService';
import { navigationService } from './navigationService';

/**
 * Service for handling default pages for navigation routes
 * This service provides methods to fetch and manage default pages for navigation routes,
 * including unpublished pages.
 */
export const defaultPageService = {
  /**
   * Utility function to normalize UUIDs by removing hyphens
   */
  normalizeUuid(id: string): string {
    if (!id) return id;
    return id.replace(/-/g, '');
  },

  /**
   * Get a page by ID, bypassing the publication check if it's a default page for a navigation route
   * @param pageId The ID of the page to fetch
   * @returns The page, or null if not found
   */
  async getDefaultPage(pageId: string): Promise<Page | null> {
    try {
      // Normalize the UUID to ensure consistent format (no hyphens)
      const normalizedId = this.normalizeUuid(pageId);
      console.log(`defaultPageService: Using normalized ID: ${normalizedId} (original: ${pageId})`);
      
      // First, try to fetch the page directly with the normalized ID
      try {
        const page = await pageService.getPage(normalizedId);
        console.log(`defaultPageService: Found page with normalized ID: ${page.name}`);
        return page;
      } catch (fetchError) {
        console.log(`defaultPageService: Failed to fetch with normalized ID, trying original: ${fetchError}`);
        
        // If the normalized ID fails and it's different from the original, try the original
        if (normalizedId !== pageId) {
          try {
            const page = await pageService.getPage(pageId);
            console.log(`defaultPageService: Found page with original ID: ${page.name}`);
            return page;
          } catch (originalError) {
            console.log(`defaultPageService: Failed with both IDs, handling error: ${originalError}`);
          }
        }
        
        // If the error is about the page not being published, we need to handle it differently
        if (fetchError instanceof Error && fetchError.message.includes('not published')) {
          console.log('Page is not published, creating a placeholder page');
          
          try {
            // Create a custom page object with the data we have
            // This is a workaround since we can't modify the backend API
            const customPage: Page = {
              id: normalizedId, // Use the normalized ID for consistency
              name: 'Unpublished Default Page',
              description: 'This page is set as the default for a navigation route but is not published.',
              layouts: {
                desktop: [],
                tablet: [],
                mobile: []
              },
              is_published: false,
              content: {
                layouts: {
                  desktop: [],
                  tablet: [],
                  mobile: []
                },
                modules: {}
              },
              modules: {}
            };
            
            return customPage;
          } catch (customError) {
            console.error('Error creating custom page:', customError);
            return null;
          }
        }
      }
      
      console.error(`Error fetching default page ${pageId}:`, 'All attempts failed');
      return null;
    } catch (error) {
      console.error(`Unexpected error in getDefaultPage for ${pageId}:`, error);
      return null;
    }
  },
  
  /**
   * Get the default page for a navigation route
   * @param routeId The ID of the navigation route
   * @returns The default page, or null if not found
   */
  async getDefaultPageForRoute(routeId: string): Promise<Page | null> {
    try {
      // Get the navigation route
      const route = await navigationService.getNavigationRoute(routeId);
      if (!route || !route.default_page_id) {
        return null;
      }
      
      // Get the default page
      return await this.getDefaultPage(route.default_page_id);
    } catch (error) {
      console.error(`Error fetching default page for route ${routeId}:`, error);
      return null;
    }
  }
};
