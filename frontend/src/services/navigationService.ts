import ApiService from './ApiService';
import { NavigationRoute } from '../types/navigation';

const API_PATH = '/api/v1/navigation-routes';

export const navigationService = {
  // Get all navigation routes
  async getNavigationRoutes(): Promise<NavigationRoute[]> {
    try {
      const apiService = ApiService.getInstance();
      
      // Check if we have an access token
      const token = localStorage.getItem('accessToken');
      
      // Check if we have a valid token before making the API call
      if (!token) {
        console.warn('No access token available, skipping navigation routes API call');
        return [];
      }
      
      const response = await apiService.get(API_PATH);
      
      // If response is empty or not an array, return an empty array
      if (!response) {
        console.warn('Navigation routes response is empty');
        return [];
      }
      
      if (!Array.isArray(response)) {
        console.warn('Navigation routes response is not an array:', response);
        // Try to convert to array if possible
        if (response && typeof response === 'object') {
          // console.log('Attempting to convert response to array');
          const converted = Object.values(response) as NavigationRoute[];
          // console.log('Converted response:', converted);
          return converted;
        }
        return [];
      }
      
      // Log each route for debugging
      response.forEach((route, index) => {
        // console.log(`Route ${index}:`, route);
      });
      
      return response;
    } catch (error) {
      console.error('Failed to fetch navigation routes:', error);
      // Return empty array instead of throwing to prevent UI errors
      return [];
    }
  },

  // Get a navigation route by ID
  async getNavigationRoute(routeId: string): Promise<NavigationRoute | null> {
    try {
      // console.log(`Fetching navigation route with ID: ${routeId}`);
      const apiService = ApiService.getInstance();
      const response = await apiService.get(`${API_PATH}/${routeId}`);
      // console.log(`Navigation route ${routeId} response:`, response);
      
      if (!response) {
        console.warn(`Navigation route ${routeId} response is empty`);
        return null;
      }
      
      return response;
    } catch (error) {
      console.error(`Failed to fetch navigation route ${routeId}:`, error);
      return null;
    }
  },

  // Create a new navigation route
  async createNavigationRoute(routeData: Partial<NavigationRoute>): Promise<NavigationRoute> {
    try {
      const apiService = ApiService.getInstance();
      
      // Create a new object with all properties
      const dataToSend = { ...routeData };
      
      // Ensure default_page_id is explicitly null if not provided
      if (dataToSend.default_page_id === null) {
        // console.log('default_page_id is explicitly null for new route');
      } else if (dataToSend.default_page_id) {
        // console.log(`default_page_id has a value for new route: ${dataToSend.default_page_id}`);
      } else {
        // console.log('default_page_id is undefined or empty for new route - setting to explicit null');
        // Use type assertion to allow null assignment for API compatibility
        (dataToSend as any).default_page_id = null;
      }
      
      // console.log('Final data being sent to backend for new route:', JSON.stringify(dataToSend, null, 2));
      
      return await apiService.post(API_PATH, dataToSend);
    } catch (error) {
      console.error('Failed to create navigation route:', error);
      throw new Error(`Failed to create navigation route: ${error instanceof Error ? error.message : String(error)}`);
    }
  },

  // Update a navigation route
  async updateNavigationRoute(routeId: string, routeData: Partial<NavigationRoute>): Promise<NavigationRoute> {
    try {
      // console.log(`Updating navigation route with ID: ${routeId}`);
      // console.log('Route data being sent:', JSON.stringify(routeData, null, 2));
      // console.log('default_page_id type:', routeData.default_page_id === null ? 'null' : typeof routeData.default_page_id);
      
      // Format the route ID properly with hyphens if needed
      const formattedRouteId = routeId.replace(/([0-9a-f]{8})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{12})/i, '$1-$2-$3-$4-$5');
      // console.log(`Formatted route ID: ${formattedRouteId}`);
      
      // Ensure default_page_id is properly formatted if present
      if (routeData.default_page_id) {
        // Format UUID with hyphens if it doesn't have them
        if (!routeData.default_page_id.includes('-')) {
          routeData.default_page_id = routeData.default_page_id.replace(
            /([0-9a-f]{8})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{12})/i,
            '$1-$2-$3-$4-$5'
          );
          // console.log(`Formatted default_page_id: ${routeData.default_page_id}`);
        }
      } else if (routeData.default_page_id === null) {
        // Explicitly log when we're clearing the default_page_id
        // console.log('Explicitly setting default_page_id to null');
      }
      
      const apiService = ApiService.getInstance();
      
      // Create a new object with all properties
      const dataToSend = { ...routeData };
      
      // Log the default_page_id value
      if (dataToSend.default_page_id === null) {
        // console.log('default_page_id is explicitly null - this should clear it in the database');
      } else if (dataToSend.default_page_id) {
        // console.log(`default_page_id has a value: ${dataToSend.default_page_id}`);
      } else {
        // console.log('default_page_id is undefined or empty - setting to explicit null');
        // Use type assertion to allow null assignment for API compatibility
        (dataToSend as any).default_page_id = null;
      }
      
      // console.log('Final data being sent to backend:', JSON.stringify(dataToSend, null, 2));
      
      return await apiService.put(`${API_PATH}/${formattedRouteId}`, dataToSend);
    } catch (error) {
      console.error(`Failed to update navigation route ${routeId}:`, error);
      throw new Error(`Failed to update navigation route: ${error instanceof Error ? error.message : String(error)}`);
    }
  },

  // Delete a navigation route
  async deleteNavigationRoute(routeId: string): Promise<void> {
    try {
      const apiService = ApiService.getInstance();
      await apiService.delete(`${API_PATH}/${routeId}`);
    } catch (error) {
      console.error(`Failed to delete navigation route ${routeId}:`, error);
      throw new Error(`Failed to delete navigation route: ${error instanceof Error ? error.message : String(error)}`);
    }
  },

  // Get visible navigation routes
  async getVisibleNavigationRoutes(): Promise<NavigationRoute[]> {
    try {
      // console.log('Fetching visible navigation routes');
      const apiService = ApiService.getInstance();
      const response = await apiService.get(`${API_PATH}`, {
        params: { visible_only: 'true' }
      });
      
      // console.log('Visible navigation routes response:', response);
      
      // If response is empty or not an array, return an empty array
      if (!response || !Array.isArray(response)) {
        console.warn('Visible navigation routes response is not an array:', response);
        return [];
      }
      
      return response;
    } catch (error) {
      console.error('Failed to fetch visible navigation routes:', error);
      // Return empty array instead of throwing to prevent UI errors
      return [];
    }
  },

  // Get a navigation route by route path
  async getNavigationRouteByRoute(route: string): Promise<NavigationRoute | null> {
    try {
      // console.log(`Fetching navigation route with route path: ${route}`);
      
      // First get all routes
      const routes = await this.getNavigationRoutes();
      
      // Find the route with the matching route path
      const matchingRoute = routes.find(r => r.route === route);
      
      if (!matchingRoute) {
        console.warn(`No navigation route found with route path: ${route}`);
        return null;
      }
      
      // console.log(`Found navigation route for path ${route}:`, matchingRoute);
      return matchingRoute;
    } catch (error) {
      console.error(`Failed to fetch navigation route by path ${route}:`, error);
      return null;
    }
  }
};
