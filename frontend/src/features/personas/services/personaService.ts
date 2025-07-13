import { Persona, PersonaCreate, PersonaUpdate, PersonaFilters } from '../types';
import ApiService from '../../../services/ApiService';

/**
 * Service for interacting with the Personas API
 */
export class PersonaService {
  private static instance: PersonaService;
  private apiService: ApiService;
  private basePath: string;

  private constructor() {
    this.apiService = ApiService.getInstance();
    this.basePath = '/api/v1/personas';
  }

  /**
   * Get the singleton instance of PersonaService
   */
  public static getInstance(): PersonaService {
    if (!PersonaService.instance) {
      PersonaService.instance = new PersonaService();
    }
    return PersonaService.instance;
  }

  /**
   * Get all personas with optional filtering
   */
  async getPersonas(options: {
    search?: string;
    tags?: string[];
    is_active?: boolean;
    page?: number;
    pageSize?: number;
  }): Promise<{ personas: Persona[]; totalItems: number }> {
    const { search, tags, is_active, page = 1, pageSize = 16 } = options;
    
    const params: Record<string, any> = {
      page,
      pageSize
    };
    
    if (search) {
      params.search = search;
    }
    
    if (tags && tags.length > 0) {
      params.tags = tags.join(',');
    }
    
    if (is_active !== undefined) {
      params.is_active = is_active;
    }
    
    try {
      const response = await this.apiService.get(`${this.basePath}`, { params });
      return {
        personas: response.personas || [],
        totalItems: response.totalItems || 0
      };
    } catch (error) {
      console.error('Failed to fetch personas:', error);
      throw error;
    }
  }

  /**
   * Get a specific persona by ID
   */
  async getPersona(personaId: string): Promise<Persona> {
    try {
      const response = await this.apiService.get(`${this.basePath}/${personaId}`);
      return response;
    } catch (error) {
      console.error(`Failed to fetch persona ${personaId}:`, error);
      throw error;
    }
  }

  /**
   * Create a new persona
   */
  async createPersona(personaData: PersonaCreate): Promise<Persona> {
    try {
      const response = await this.apiService.post(`${this.basePath}`, personaData);
      return response;
    } catch (error) {
      console.error('Failed to create persona:', error);
      throw error;
    }
  }

  /**
   * Update an existing persona
   */
  async updatePersona(personaId: string, personaData: PersonaUpdate): Promise<Persona> {
    try {
      const response = await this.apiService.put(`${this.basePath}/${personaId}`, personaData);
      return response;
    } catch (error) {
      console.error(`Failed to update persona ${personaId}:`, error);
      throw error;
    }
  }

  /**
   * Delete a persona
   */
  async deletePersona(personaId: string): Promise<void> {
    try {
      await this.apiService.delete(`${this.basePath}/${personaId}`);
    } catch (error) {
      console.error(`Failed to delete persona ${personaId}:`, error);
      throw error;
    }
  }

  /**
   * Toggle a persona's active status
   */
  async togglePersonaStatus(personaId: string, is_active: boolean): Promise<void> {
    try {
      await this.apiService.patch(`${this.basePath}/${personaId}`, {
        is_active
      });
    } catch (error) {
      console.error(`Failed to toggle persona ${personaId} status:`, error);
      throw error;
    }
  }

  /**
   * Get all available tags
   */
  async getTags(): Promise<string[]> {
    try {
      const response = await this.apiService.get(`${this.basePath}/tags`);
      return response.tags || [];
    } catch (error) {
      console.error('Failed to fetch persona tags:', error);
      // Return empty array on error
      return [];
    }
  }

  /**
   * Validate model settings
   */
  validateModelSettings(settings: any): string[] {
    const errors: string[] = [];
    
    if (settings.temperature !== undefined) {
      if (typeof settings.temperature !== 'number' || settings.temperature < 0 || settings.temperature > 2) {
        errors.push('Temperature must be a number between 0.0 and 2.0');
      }
    }
    
    if (settings.top_p !== undefined) {
      if (typeof settings.top_p !== 'number' || settings.top_p < 0 || settings.top_p > 1) {
        errors.push('Top-p must be a number between 0.0 and 1.0');
      }
    }
    
    if (settings.frequency_penalty !== undefined) {
      if (typeof settings.frequency_penalty !== 'number' || settings.frequency_penalty < -2 || settings.frequency_penalty > 2) {
        errors.push('Frequency penalty must be a number between -2.0 and 2.0');
      }
    }
    
    if (settings.presence_penalty !== undefined) {
      if (typeof settings.presence_penalty !== 'number' || settings.presence_penalty < -2 || settings.presence_penalty > 2) {
        errors.push('Presence penalty must be a number between -2.0 and 2.0');
      }
    }
    
    if (settings.context_window !== undefined) {
      if (typeof settings.context_window !== 'number' || settings.context_window <= 0 || !Number.isInteger(settings.context_window)) {
        errors.push('Context window must be a positive integer');
      }
    }
    
    if (settings.stop_sequences !== undefined) {
      if (!Array.isArray(settings.stop_sequences)) {
        errors.push('Stop sequences must be an array of strings');
      } else if (!settings.stop_sequences.every((seq: any) => typeof seq === 'string')) {
        errors.push('All stop sequences must be strings');
      }
    }
    
    return errors;
  }
}

// Export a singleton instance
export const personaService = PersonaService.getInstance();

export default personaService;