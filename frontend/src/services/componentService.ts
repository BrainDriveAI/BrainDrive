import ApiService from './ApiService';
import { Component } from '../types/component';

const API_PATH = '/api/v1/components';

export const componentService = {
  // Get all components
  async getComponents(): Promise<Component[]> {
    try {
      // console.log('Fetching components from:', API_PATH);
      const apiService = ApiService.getInstance();
      const response = await apiService.get(API_PATH);
      
      // Check if we got a valid array
      if (!response || !Array.isArray(response)) {
        console.warn('Components response is not an array:', response);
        return [];
      }
      
      // console.log('Components response:', response);
      return response;
    } catch (error) {
      console.error('Failed to fetch components:', error);
      return [];
    }
  },

  // Get a component by ID
  async getComponentById(componentId: string): Promise<Component | null> {
    try {
      const apiService = ApiService.getInstance();
      const response = await apiService.get(`${API_PATH}/${componentId}`);
      
      if (!response) {
        console.warn(`Component ${componentId} response is empty`);
        return null;
      }
      
      return response;
    } catch (error) {
      console.error(`Failed to fetch component ${componentId}:`, error);
      return null;
    }
  },

  // Get a component by component_id
  async getComponentByComponentId(componentId: string): Promise<Component | null> {
    try {
      // console.log(`Looking for component with component_id: ${componentId}`);
      
      // Get all components and find the one with the matching component_id
      const components = await this.getComponents();
      // console.log(`Found ${components.length} components:`, components);
      
      const component = components.find(c => c.component_id === componentId);
      if (component) {
        // console.log(`Found component with component_id ${componentId}:`, component);
      } else {
        // console.log(`No component found with component_id ${componentId}`);
      }
      
      return component || null;
    } catch (error) {
      console.error(`Failed to fetch component by component_id ${componentId}:`, error);
      return null;
    }
  },

  // Create a new component
  async createComponent(componentData: Partial<Component>): Promise<Component> {
    try {
      const apiService = ApiService.getInstance();
      return await apiService.post(API_PATH, componentData);
    } catch (error) {
      console.error('Failed to create component:', error);
      throw new Error(`Failed to create component: ${error instanceof Error ? error.message : String(error)}`);
    }
  },

  // Update a component
  async updateComponent(componentId: string, componentData: Partial<Component>): Promise<Component> {
    try {
      const apiService = ApiService.getInstance();
      return await apiService.put(`${API_PATH}/${componentId}`, componentData);
    } catch (error) {
      console.error(`Failed to update component ${componentId}:`, error);
      throw new Error(`Failed to update component: ${error instanceof Error ? error.message : String(error)}`);
    }
  },

  // Delete a component
  async deleteComponent(componentId: string): Promise<void> {
    try {
      const apiService = ApiService.getInstance();
      await apiService.delete(`${API_PATH}/${componentId}`);
    } catch (error) {
      console.error(`Failed to delete component ${componentId}:`, error);
      throw new Error(`Failed to delete component: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
};
