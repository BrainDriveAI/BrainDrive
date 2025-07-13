/**
 * TypeScript interfaces for the Personas feature
 */

export interface ModelSettings {
  temperature?: number;      // 0.0-2.0
  top_p?: number;           // 0.0-1.0
  frequency_penalty?: number; // -2.0-2.0
  presence_penalty?: number;  // -2.0-2.0
  context_window?: number;    // positive integer
  stop_sequences?: string[];  // array of strings
}

export interface Persona {
  id: string;
  name: string;
  description?: string;
  system_prompt: string;
  model_settings?: ModelSettings;
  avatar?: string;
  tags?: string[];
  sample_greeting?: string;
  is_active: boolean;
  user_id: string;
  created_at: string;
  updated_at: string;
}

export interface PersonaFilters {
  search?: string;
  tags?: string[];
  is_active?: boolean;
}

export interface PersonaCreate {
  name: string;
  description?: string;
  system_prompt: string;
  model_settings?: ModelSettings;
  avatar?: string;
  tags?: string[];
  sample_greeting?: string;
  is_active?: boolean;
}

export interface PersonaUpdate {
  name?: string;
  description?: string;
  system_prompt?: string;
  model_settings?: ModelSettings;
  avatar?: string;
  tags?: string[];
  sample_greeting?: string;
  is_active?: boolean;
}

export interface UsePersonasOptions {
  search?: string;
  tags?: string[];
  is_active?: boolean;
  page?: number;
  pageSize?: number;
}

export interface UsePersonasResult {
  personas: Persona[];
  totalPersonas: number;
  loading: boolean;
  error: Error | null;
  togglePersonaStatus: (personaId: string, enabled: boolean) => Promise<void>;
  createPersona: (personaData: PersonaCreate) => Promise<Persona>;
  updatePersona: (personaId: string, personaData: PersonaUpdate) => Promise<Persona>;
  deletePersona: (personaId: string) => Promise<void>;
  refetch: () => Promise<void>;
}