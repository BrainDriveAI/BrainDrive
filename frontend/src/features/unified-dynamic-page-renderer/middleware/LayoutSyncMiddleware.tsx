import React, { useEffect, useRef } from 'react';
import { ResponsiveLayouts } from '../types';
import { LayoutChangeOrigin } from '../utils/layoutChangeManager';

export interface LayoutSyncMiddlewareProps {
  children: React.ReactNode;
  onLayoutSync?: (layouts: ResponsiveLayouts, origin: LayoutChangeOrigin) => void;
}

/**
 * Layout Synchronization Middleware
 * 
 * This middleware component sits between the unified layout system and external
 * systems to coordinate layout changes and prevent conflicts.
 */
export const LayoutSyncMiddleware: React.FC<LayoutSyncMiddlewareProps> = ({
  children,
  onLayoutSync
}) => {
  const syncInProgressRef = useRef(false);
  const lastSyncHashRef = useRef<string | null>(null);

  // Listen for layout sync events
  useEffect(() => {
    const handleLayoutSync = (event: CustomEvent) => {
      const { layouts, origin } = event.detail;
      
      // Prevent recursive syncing
      if (syncInProgressRef.current) {
        console.log('[LayoutSyncMiddleware] Sync already in progress, skipping');
        return;
      }

      // Generate hash to prevent duplicate syncs
      const layoutHash = JSON.stringify(layouts);
      if (layoutHash === lastSyncHashRef.current) {
        console.log('[LayoutSyncMiddleware] Duplicate sync detected, skipping');
        return;
      }

      console.log(`[LayoutSyncMiddleware] Processing layout sync from ${origin.source}`);
      
      syncInProgressRef.current = true;
      lastSyncHashRef.current = layoutHash;
      
      try {
        onLayoutSync?.(layouts, origin);
      } catch (error) {
        console.error('[LayoutSyncMiddleware] Error during layout sync:', error);
      } finally {
        // Reset sync flag after a brief delay
        setTimeout(() => {
          syncInProgressRef.current = false;
        }, 100);
      }
    };

    // Listen for custom layout sync events
    window.addEventListener('unified-layout-sync', handleLayoutSync as EventListener);
    
    return () => {
      window.removeEventListener('unified-layout-sync', handleLayoutSync as EventListener);
    };
  }, [onLayoutSync]);

  // Provide sync utilities to children via context if needed
  return <>{children}</>;
};

/**
 * Utility function to emit layout sync events
 */
export const emitLayoutSync = (layouts: ResponsiveLayouts, origin: LayoutChangeOrigin) => {
  if (typeof window !== 'undefined') {
    const event = new CustomEvent('unified-layout-sync', {
      detail: { layouts, origin }
    });
    window.dispatchEvent(event);
  }
};