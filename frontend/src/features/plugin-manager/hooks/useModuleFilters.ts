import { useState, useEffect, useCallback, useRef } from 'react';
import moduleService from '../services/moduleService';

interface UseModuleFiltersResult {
  categories: string[];
  tags: string[];
  selectedCategory: string | null;
  selectedTags: string[];
  setSelectedCategory: (category: string | null) => void;
  setSelectedTags: (tags: string[]) => void;
  loading: boolean;
  error: Error | null;
}

/**
 * Hook for managing module filters (categories and tags)
 * 
 * Note: Currently using mock data until backend API is implemented
 */
export const useModuleFilters = (): UseModuleFiltersResult => {
  const [categories, setCategories] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const fetchCount = useRef(0);

  const fetchFilters = useCallback(async () => {
    try {
      // Increment fetch count to track how many times this function is called
      fetchCount.current += 1;
      console.log(`Fetching filters (call #${fetchCount.current})`);
      
      setLoading(true);
      setError(null);
      
      // Fetch categories and tags in parallel
      const [categoriesResult, tagsResult] = await Promise.all([
        moduleService.getCategories(),
        moduleService.getTags()
      ]);
      
      setCategories(categoriesResult);
      setTags(tagsResult);
      console.log(`Fetched ${categoriesResult.length} categories and ${tagsResult.length} tags`);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch filters'));
      console.error('Error fetching filters:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    console.log('useEffect in useModuleFilters triggered');
    fetchFilters();
  }, [fetchFilters]);

  return {
    categories,
    tags,
    selectedCategory,
    selectedTags,
    setSelectedCategory,
    setSelectedTags,
    loading,
    error
  };
};

export default useModuleFilters;
