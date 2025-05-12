import { Page } from '../pages';
import ApiService from './ApiService';

const API_PATH = '/api/v1/pages';

// Utility function to handle UUIDs consistently
const formatUuid = (id: string): string => {
  if (!id) return id;
  // Remove hyphens from the UUID to match the backend's new format
  console.log(`Formatting UUID: ${id}`);
  const formatted = id.replace(/-/g, '');
  console.log(`Formatted UUID result: ${formatted}`);
  return formatted;
};

export const pageService = {
  // Get all pages
  async getPages(): Promise<{ pages: Page[] }> {
    try {
      const apiService = ApiService.getInstance();
      return await apiService.get(API_PATH);
    } catch (error) {
      console.error('Failed to fetch pages:', error);
      throw new Error(`Failed to fetch pages: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
  
  // Get a page by ID
  async getPage(pageId: string): Promise<Page> {
    try {
      const apiService = ApiService.getInstance();
      // Format the page ID without hyphens for API calls
      const formattedPageId = formatUuid(pageId);
      return await apiService.get(`${API_PATH}/${formattedPageId}`);
    } catch (error) {
      console.error(`Failed to fetch page ${pageId}:`, error);
      throw new Error(`Failed to fetch page: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
  
  // Get a page by route
  async getPageByRoute(route: string): Promise<Page> {
    try {
      const apiService = ApiService.getInstance();
      return await apiService.get(`${API_PATH}/route/${route}`);
    } catch (error) {
      console.error(`Failed to fetch page by route ${route}:`, error);
      throw new Error(`Failed to fetch page: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
  
  // Get pages by parent type
  async getPagesByParentType(parentType: string): Promise<Page[]> {
    try {
      const apiService = ApiService.getInstance();
      const data = await apiService.get(`${API_PATH}`, { 
        params: { 
          parent_type: parentType,
          published_only: 'true' 
        } 
      });
      return data.pages;
    } catch (error) {
      console.error(`Failed to fetch pages for parent type ${parentType}:`, error);
      throw new Error(`Failed to fetch pages: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
  
  // Get pages by parent route
  async getPagesByParentRoute(parentRoute: string): Promise<Page[]> {
    try {
      const apiService = ApiService.getInstance();
      const data = await apiService.get(`${API_PATH}`, { 
        params: { 
          parent_route: parentRoute,
          published_only: 'true' 
        } 
      });
      return data.pages;
    } catch (error) {
      console.error(`Failed to fetch child pages for ${parentRoute}:`, error);
      throw new Error(`Failed to fetch child pages: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
  
  // Get parent pages
  async getParentPages(): Promise<Page[]> {
    try {
      const apiService = ApiService.getInstance();
      const data = await apiService.get(`${API_PATH}`, { 
        params: { 
          is_parent_page: true,
          published_only: 'true' 
        } 
      });
      return data.pages;
    } catch (error) {
      console.error('Failed to fetch parent pages:', error);
      throw new Error(`Failed to fetch parent pages: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
  
  // Get all published pages
  async getPublishedPages(): Promise<Page[]> {
    try {
      const apiService = ApiService.getInstance();
      const data = await apiService.get(`${API_PATH}`, { 
        params: { published_only: 'true' } 
      });
      return data.pages;
    } catch (error) {
      console.error('Failed to fetch published pages:', error);
      throw new Error(`Failed to fetch pages: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
  
  // Get child pages for a parent route
  async getChildPages(parentRoute: string): Promise<Page[]> {
    try {
      const apiService = ApiService.getInstance();
      const data = await apiService.get(`${API_PATH}`, { 
        params: { 
          parent_route: parentRoute,
          published_only: 'true' 
        } 
      });
      return data.pages;
    } catch (error) {
      console.error(`Failed to fetch child pages for ${parentRoute}:`, error);
      throw new Error(`Failed to fetch child pages: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
  
  // Create a new page
  async createPage(pageData: Partial<Page>): Promise<Page> {
    try {
      const apiService = ApiService.getInstance();
      
      // Format navigation_route_id if present
      if (pageData.navigation_route_id) {
        pageData.navigation_route_id = formatUuid(pageData.navigation_route_id as string);
      }
      
      return await apiService.post(API_PATH, pageData);
    } catch (error) {
      console.error('Failed to create page:', error);
      throw new Error(`Failed to create page: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
  
  // Update a page
  async updatePage(pageId: string, pageData: Partial<Page>): Promise<Page> {
    try {
      console.log(`Updating page with ID: ${pageId}`);
      console.log('Page data being sent:', JSON.stringify(pageData, null, 2));
      
      // Format the page ID properly with hyphens if needed
      const formattedPageId = formatUuid(pageId);
      console.log(`Formatted page ID: ${formattedPageId}`);
      
      // Handle navigation_route_id explicitly, including null values and empty strings
      if (pageData.hasOwnProperty('navigation_route_id')) {
        console.log(`Original navigation_route_id value: ${pageData.navigation_route_id}, type: ${typeof pageData.navigation_route_id}`);
        
        if (pageData.navigation_route_id === null) {
          // Explicitly set to null when null is passed
          console.log('Explicitly setting navigation_route_id to null');
          // Use type assertion to handle null value
          (pageData as any).navigation_route_id = null;
        } else if (pageData.navigation_route_id === "") {
          // Handle empty string case
          console.log('Empty string detected for navigation_route_id, setting to null');
          // Use type assertion to handle null value
          (pageData as any).navigation_route_id = null;
        } else if (pageData.navigation_route_id) {
          // Format UUID with hyphens if it doesn't have them
          if (typeof pageData.navigation_route_id === 'string') {
            const originalValue = pageData.navigation_route_id;
            pageData.navigation_route_id = formatUuid(pageData.navigation_route_id);
            console.log(`Formatted navigation_route_id: from ${originalValue} to ${pageData.navigation_route_id}`);
          }
        }
      } else {
        console.log('No navigation_route_id property in the update data');
      }
      
      console.log('Final page data being sent to API:', JSON.stringify(pageData, null, 2));
      
      const apiService = ApiService.getInstance();
      const response = await apiService.put(`${API_PATH}/${formattedPageId}`, pageData);
      console.log('Response from updatePage API call:', JSON.stringify(response, null, 2));
      return response;
    } catch (error) {
      console.error(`Failed to update page ${pageId}:`, error);
      throw new Error(`Failed to update page: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
  
  // Delete a page
  async deletePage(pageId: string): Promise<void> {
    try {
      const apiService = ApiService.getInstance();
      // Format the page ID properly with hyphens if needed
      const formattedPageId = formatUuid(pageId);
      await apiService.delete(`${API_PATH}/${formattedPageId}`);
    } catch (error) {
      console.error(`Failed to delete page ${pageId}:`, error);
      throw new Error(`Failed to delete page: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
  
  // Publish/unpublish a page
  async publishPage(pageId: string, publish: boolean): Promise<Page> {
    try {
      console.log(`${publish ? 'Publishing' : 'Unpublishing'} page with ID: ${pageId}`);
      
      // Format the page ID properly with hyphens if needed
      const formattedPageId = formatUuid(pageId);
      console.log(`Formatted page ID: ${formattedPageId}`);
      
      const apiService = ApiService.getInstance();
      return await apiService.post(`${API_PATH}/${formattedPageId}/publish`, { publish });
    } catch (error) {
      console.error(`Failed to ${publish ? 'publish' : 'unpublish'} page ${pageId}:`, error);
      throw new Error(`Failed to ${publish ? 'publish' : 'unpublish'} page: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
  
  // Create a backup of a page
  async backupPage(pageId: string): Promise<Page> {
    try {
      const apiService = ApiService.getInstance();
      const formattedPageId = formatUuid(pageId);
      return await apiService.post(`${API_PATH}/${formattedPageId}/backup`, { create_backup: true });
    } catch (error) {
      console.error(`Failed to create backup for page ${pageId}:`, error);
      throw new Error(`Failed to create backup: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
  
  // Restore a page from backup
  async restorePage(pageId: string): Promise<Page> {
    try {
      const apiService = ApiService.getInstance();
      const formattedPageId = formatUuid(pageId);
      return await apiService.post(`${API_PATH}/${formattedPageId}/restore`, {});
    } catch (error) {
      console.error(`Failed to restore page ${pageId}:`, error);
      throw new Error(`Failed to restore page: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
  
  // Update page hierarchy
  async updatePageHierarchy(pageId: string, hierarchyData: {
    parent_route?: string | null;
    parent_type?: string;
    route_segment?: string;
    is_parent_page?: boolean;
  }): Promise<Page> {
    try {
      console.log(`Updating page hierarchy for page ${pageId} with data:`, hierarchyData);
      
      // Format the page ID properly with hyphens if needed
      const formattedPageId = formatUuid(pageId);
      console.log(`Formatted page ID: ${formattedPageId}`);
      
      // Ensure parent_route is explicitly set to empty string if it should be cleared
      if (hierarchyData.parent_route === null || hierarchyData.parent_route === undefined) {
        hierarchyData.parent_route = '';
        console.log('Setting parent_route to empty string explicitly');
      }
      
      // Ensure parent_type is set to a valid value
      if (!hierarchyData.parent_type) {
        hierarchyData.parent_type = 'page';
        console.log('Setting default parent_type to "page"');
      }
      
      const apiService = ApiService.getInstance();
      const result = await apiService.put(`${API_PATH}/${formattedPageId}/hierarchy`, hierarchyData);
      console.log(`Page hierarchy update result:`, result);
      return result;
    } catch (error) {
      console.error(`Failed to update hierarchy for page ${pageId}:`, error);
      throw new Error(`Failed to update page hierarchy: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
};
