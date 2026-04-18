import { useCallback, useEffect, useRef, useState } from "react";

import { getUpdateStatus, type UpdateStatusPayload } from "@/api/update-adapter";

function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
}

export function useUpdateStatus(): {
  updateStatus: UpdateStatusPayload | null;
  hasUpdateAvailable: boolean;
  isLoading: boolean;
  error: Error | null;
  refreshStatus: () => void;
} {
  const [updateStatus, setUpdateStatus] = useState<UpdateStatusPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const requestIdRef = useRef(0);

  const refreshStatus = useCallback(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    setIsLoading(true);
    setError(null);

    void getUpdateStatus()
      .then((nextStatus) => {
        if (requestIdRef.current !== requestId) {
          return;
        }

        setUpdateStatus(nextStatus);
      })
      .catch((nextError) => {
        if (requestIdRef.current !== requestId) {
          return;
        }

        setUpdateStatus(null);
        setError(toError(nextError));
      })
      .finally(() => {
        if (requestIdRef.current === requestId) {
          setIsLoading(false);
        }
      });
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  useEffect(() => () => {
    requestIdRef.current += 1;
  }, []);

  return {
    updateStatus,
    hasUpdateAvailable: updateStatus?.update_available === true,
    isLoading,
    error,
    refreshStatus,
  };
}
