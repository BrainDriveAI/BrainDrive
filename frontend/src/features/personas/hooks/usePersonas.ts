import { useState, useEffect, useCallback, useRef } from 'react';
import { Persona, PersonaCreate, PersonaUpdate, UsePersonasOptions, UsePersonasResult } from '../types';
import personaService from '../services/personaService';

/**
 * Hook for fetching and managing personas
 */
export const usePersonas = (options: UsePersonasOptions = {}): UsePersonasResult => {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [totalPersonas, setTotalPersonas] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const fetchCount = useRef(0);

  // Memoize options to prevent unnecessary re-renders
  const memoizedOptions = useCallback(() => {
    return {
      search: options.search || '',
      tags: options.tags || [],
      is_active: options.is_active,
      page: options.page || 1,
      pageSize: options.pageSize || 16
    };
  }, [options.search, options.tags?.join(','), options.is_active, options.page, options.pageSize]);

  const fetchPersonas = useCallback(async () => {
    try {
      // Increment fetch count to track how many times this function is called
      fetchCount.current += 1;
      console.log(`Fetching personas (call #${fetchCount.current})`, memoizedOptions());
      
      setLoading(true);
      setError(null);
      
      // Use the personaService to fetch personas
      const result = await personaService.getPersonas(memoizedOptions());
      
      setPersonas(result.personas);
      setTotalPersonas(result.totalItems);
      console.log(`Fetched ${result.personas.length} personas`);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch personas'));
      console.error('Error fetching personas:', err);
    } finally {
      setLoading(false);
    }
  }, [memoizedOptions]);

  useEffect(() => {
    console.log('useEffect in usePersonas triggered');
    fetchPersonas();
  }, [fetchPersonas]);

  const togglePersonaStatus = useCallback(async (personaId: string, enabled: boolean) => {
    try {
      await personaService.togglePersonaStatus(personaId, enabled);
      
      // Update the local state
      setPersonas(prevPersonas =>
        prevPersonas.map(persona =>
          persona.id === personaId
            ? { ...persona, is_active: enabled }
            : persona
        )
      );
    } catch (err) {
      console.error(`Error toggling persona ${personaId} status:`, err);
      throw err;
    }
  }, []);

  const createPersona = useCallback(async (personaData: PersonaCreate): Promise<Persona> => {
    try {
      const newPersona = await personaService.createPersona(personaData);
      
      // Add to local state (optimistic update)
      setPersonas(prevPersonas => [newPersona, ...prevPersonas]);
      setTotalPersonas(prev => prev + 1);
      
      return newPersona;
    } catch (err) {
      console.error('Error creating persona:', err);
      throw err;
    }
  }, []);

  const updatePersona = useCallback(async (personaId: string, personaData: PersonaUpdate): Promise<Persona> => {
    try {
      const updatedPersona = await personaService.updatePersona(personaId, personaData);
      
      // Update local state
      setPersonas(prevPersonas =>
        prevPersonas.map(persona =>
          persona.id === personaId ? updatedPersona : persona
        )
      );
      
      return updatedPersona;
    } catch (err) {
      console.error(`Error updating persona ${personaId}:`, err);
      throw err;
    }
  }, []);

  const deletePersona = useCallback(async (personaId: string): Promise<void> => {
    try {
      await personaService.deletePersona(personaId);
      
      // Remove from local state
      setPersonas(prevPersonas =>
        prevPersonas.filter(persona => persona.id !== personaId)
      );
      setTotalPersonas(prev => Math.max(0, prev - 1));
    } catch (err) {
      console.error(`Error deleting persona ${personaId}:`, err);
      throw err;
    }
  }, []);

  return {
    personas,
    totalPersonas,
    loading,
    error,
    togglePersonaStatus,
    createPersona,
    updatePersona,
    deletePersona,
    refetch: fetchPersonas
  };
};

export default usePersonas;