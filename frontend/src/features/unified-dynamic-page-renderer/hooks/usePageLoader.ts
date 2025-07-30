import { useState, useEffect } from 'react';
import { PageData, RenderMode } from '../types';

export interface UsePageLoaderOptions {
  pageId?: string;
  route?: string;
  mode: RenderMode;
  allowUnpublished?: boolean;
}

export interface UsePageLoaderResult {
  pageData: PageData | null;
  loading: boolean;
  error: Error | null;
}

export function usePageLoader(options: UsePageLoaderOptions): UsePageLoaderResult {
  const { pageId, route, mode, allowUnpublished = false } = options;
  
  const [pageData, setPageData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const loadPage = async () => {
      try {
        setLoading(true);
        setError(null);

        // Simulate page loading - in real implementation, this would call the API
        await new Promise(resolve => setTimeout(resolve, 500));

        // Mock page data
        const mockPageData: PageData = {
          id: pageId || 'mock-page-id',
          name: 'Mock Page',
          route: route || '/mock-page',
          layouts: {
            mobile: [],
            tablet: [],
            desktop: [],
            wide: [],
          },
          modules: [],
          metadata: {
            title: 'Mock Page Title',
            description: 'Mock page description',
            lastModified: new Date(),
          },
          isPublished: mode === 'published' || allowUnpublished,
        };

        setPageData(mockPageData);
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Failed to load page');
        setError(error);
      } finally {
        setLoading(false);
      }
    };

    if (pageId || route) {
      loadPage();
    } else {
      setLoading(false);
      setError(new Error('No page ID or route provided'));
    }
  }, [pageId, route, mode, allowUnpublished]);

  return { pageData, loading, error };
}

export default usePageLoader;