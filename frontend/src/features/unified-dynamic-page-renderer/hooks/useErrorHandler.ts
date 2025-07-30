import { useCallback, useState } from 'react';

export interface UseErrorHandlerOptions {
  onError?: (error: Error) => void;
}

export interface UseErrorHandlerResult {
  error: Error | null;
  handleError: (error: Error) => void;
  clearError: () => void;
}

export function useErrorHandler(options: UseErrorHandlerOptions = {}): UseErrorHandlerResult {
  const { onError } = options;
  const [error, setError] = useState<Error | null>(null);

  const handleError = useCallback((error: Error) => {
    console.error('Error handled:', error);
    setError(error);
    onError?.(error);
  }, [onError]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    error,
    handleError,
    clearError,
  };
}

export default useErrorHandler;