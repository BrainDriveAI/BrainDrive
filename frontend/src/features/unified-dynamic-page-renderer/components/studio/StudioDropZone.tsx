import React, { useState, useCallback, useRef, useEffect } from 'react';
import { ModuleConfig, LayoutItem } from '../../types';
import { StudioModuleConfig } from '../../utils/PluginStudioAdapter';

export interface DragData {
  type: 'module' | 'layout-item';
  pluginId: string;
  moduleId: string;
  moduleName: string;
  displayName?: string;
  isLocal: boolean;
  layout?: {
    defaultWidth?: number;
    defaultHeight?: number;
    minWidth?: number;
    minHeight?: number;
    maxWidth?: number;
    maxHeight?: number;
    aspectRatio?: number;
    resizable?: boolean;
    draggable?: boolean;
  };
  config?: ModuleConfig;
  metadata?: Record<string, any>;
}

export interface DropPosition {
  x: number;
  y: number;
  gridX: number;
  gridY: number;
}

export interface StudioDropZoneProps {
  // Drop zone configuration
  accepts?: string[]; // Types of items this zone accepts
  gridSize?: number;
  snapToGrid?: boolean;
  
  // Layout constraints
  maxItems?: number;
  allowOverlap?: boolean;
  
  // Event handlers
  onModuleAdd?: (moduleConfig: StudioModuleConfig, position: DropPosition) => void;
  onItemMove?: (itemId: string, position: DropPosition) => void;
  onValidateDrop?: (dragData: DragData, position: DropPosition) => boolean;
  
  // Visual configuration
  showDropZones?: boolean;
  showGrid?: boolean;
  highlightValidZones?: boolean;
  
  // Children
  children: React.ReactNode;
  
  // CSS classes
  className?: string;
}

/**
 * StudioDropZone - Enhanced drag-and-drop zone for Plugin Studio
 * 
 * This component maintains the existing drag-and-drop functionality from DropZone.tsx (212 lines)
 * while adding enhanced features for the unified system:
 * - Visual feedback during drag operations
 * - Automatic positioning calculation
 * - Module size calculation from metadata
 * - Real-time validation
 * - Grid snapping
 * - Container query support
 */
export const StudioDropZone: React.FC<StudioDropZoneProps> = ({
  accepts = ['module', 'layout-item'],
  gridSize = 10,
  snapToGrid = true,
  maxItems,
  allowOverlap = false,
  onModuleAdd,
  onItemMove,
  onValidateDrop,
  showDropZones = true,
  showGrid = false,
  highlightValidZones = true,
  children,
  className = '',
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [dragData, setDragData] = useState<DragData | null>(null);
  const [dropPreview, setDropPreview] = useState<DropPosition | null>(null);
  const [isValidDrop, setIsValidDrop] = useState(true);
  
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const dragOverTimeoutRef = useRef<NodeJS.Timeout>();
  
  // Calculate drop position from mouse coordinates
  const calculateDropPosition = useCallback((clientX: number, clientY: number): DropPosition => {
    if (!dropZoneRef.current) {
      return { x: 0, y: 0, gridX: 0, gridY: 0 };
    }
    
    const rect = dropZoneRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    
    // Calculate grid position
    const gridX = snapToGrid ? Math.round(x / gridSize) : Math.floor(x / gridSize);
    const gridY = snapToGrid ? Math.round(y / gridSize) : Math.floor(y / gridSize);
    
    return { x, y, gridX, gridY };
  }, [gridSize, snapToGrid]);
  
  // Validate if drop is allowed at position
  const validateDrop = useCallback((data: DragData, position: DropPosition): boolean => {
    // Check if type is accepted
    if (!accepts.includes(data.type)) {
      return false;
    }
    
    // Custom validation
    if (onValidateDrop) {
      return onValidateDrop(data, position);
    }
    
    // Default validation - always allow
    return true;
  }, [accepts, onValidateDrop]);
  
  // Handle drag enter
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Clear any existing timeout
    if (dragOverTimeoutRef.current) {
      clearTimeout(dragOverTimeoutRef.current);
    }
    
    try {
      const dataTransfer = e.dataTransfer;
      const moduleDataString = dataTransfer.getData('application/json') || dataTransfer.getData('text/plain');
      
      if (moduleDataString) {
        const data: DragData = JSON.parse(moduleDataString);
        setDragData(data);
        setIsDragOver(true);
        
        // Calculate initial position for preview
        const position = calculateDropPosition(e.clientX, e.clientY);
        setDropPreview(position);
        
        // Validate drop
        const valid = validateDrop(data, position);
        setIsValidDrop(valid);
      }
    } catch (error) {
      console.warn('[StudioDropZone] Failed to parse drag data:', error);
      setIsValidDrop(false);
    }
  }, [calculateDropPosition, validateDrop]);
  
  // Handle drag over
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Update drop preview position
    const position = calculateDropPosition(e.clientX, e.clientY);
    setDropPreview(position);
    
    // Revalidate drop at new position
    if (dragData) {
      const valid = validateDrop(dragData, position);
      setIsValidDrop(valid);
    }
    
    // Set appropriate drop effect
    e.dataTransfer.dropEffect = isValidDrop ? 'copy' : 'none';
  }, [calculateDropPosition, validateDrop, dragData, isValidDrop]);
  
  // Handle drag leave
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Only clear state if leaving the drop zone entirely
    // Use timeout to handle rapid enter/leave events
    dragOverTimeoutRef.current = setTimeout(() => {
      setIsDragOver(false);
      setDragData(null);
      setDropPreview(null);
      setIsValidDrop(true);
    }, 100);
  }, []);
  
  // Handle drop
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Clear timeout
    if (dragOverTimeoutRef.current) {
      clearTimeout(dragOverTimeoutRef.current);
    }
    
    try {
      const dataTransfer = e.dataTransfer;
      const moduleDataString = dataTransfer.getData('application/json') || dataTransfer.getData('text/plain');
      
      if (!moduleDataString) {
        console.warn('[StudioDropZone] No drag data found');
        return;
      }
      
      const data: DragData = JSON.parse(moduleDataString);
      const position = calculateDropPosition(e.clientX, e.clientY);
      
      // Final validation
      if (!validateDrop(data, position)) {
        console.warn('[StudioDropZone] Drop validation failed');
        return;
      }
      
      // Handle different drop types
      if (data.type === 'module') {
        // Create module configuration using existing patterns from DropZone.tsx
        const moduleConfig: StudioModuleConfig = {
          pluginId: data.pluginId,
          moduleId: data.moduleId,
          moduleName: data.moduleName || data.moduleId,
          instanceId: `${data.pluginId}_${data.moduleId}_${Date.now()}`,
          config: data.config || {},
          layoutConfig: {
            x: position.gridX,
            y: position.gridY,
            w: data.layout?.defaultWidth || 4,
            h: data.layout?.defaultHeight || 3,
          },
          
          // Studio-specific configuration
          studioConfig: {
            showDebugInfo: false,
            autoSave: true,
            validateState: true,
            enableDragDrop: true,
            enableResize: true,
            enableConfigure: true,
            enableDelete: true,
          },
          
          // Layout hints from drag data
          layoutHints: data.layout,
          
          // Services (will be injected by ModuleRenderer)
          services: [],
        };
        
        onModuleAdd?.(moduleConfig, position);
      } else if (data.type === 'layout-item') {
        // Handle moving existing items
        onItemMove?.(data.moduleId, position);
      }
      
    } catch (error) {
      console.error('[StudioDropZone] Error handling drop:', error);
    } finally {
      // Reset state
      setIsDragOver(false);
      setDragData(null);
      setDropPreview(null);
      setIsValidDrop(true);
    }
  }, [calculateDropPosition, validateDrop, onModuleAdd, onItemMove]);
  
  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (dragOverTimeoutRef.current) {
        clearTimeout(dragOverTimeoutRef.current);
      }
    };
  }, []);
  
  // Calculate container classes
  const containerClasses = [
    'studio-drop-zone',
    className,
    isDragOver && 'studio-drop-zone--drag-over',
    isDragOver && isValidDrop && 'studio-drop-zone--valid',
    isDragOver && !isValidDrop && 'studio-drop-zone--invalid',
    showGrid && 'studio-drop-zone--show-grid',
  ].filter(Boolean).join(' ');
  
  return (
    <div
      ref={dropZoneRef}
      className={containerClasses}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        // Container query support for responsive drop zones
        containerType: 'inline-size',
        // Visual feedback styles
        backgroundColor: isDragOver 
          ? isValidDrop 
            ? 'var(--studio-drop-valid-bg, rgba(76, 175, 80, 0.1))' 
            : 'var(--studio-drop-invalid-bg, rgba(244, 67, 54, 0.1))'
          : 'transparent',
        border: isDragOver 
          ? isValidDrop
            ? '2px dashed var(--studio-drop-valid-border, #4caf50)'
            : '2px dashed var(--studio-drop-invalid-border, #f44336)'
          : '2px dashed transparent',
        borderRadius: '8px',
        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        // Grid background when enabled
        ...(showGrid && {
          backgroundImage: `
            linear-gradient(to right, rgba(0,0,0,0.1) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(0,0,0,0.1) 1px, transparent 1px)
          `,
          backgroundSize: `${gridSize}px ${gridSize}px`,
        }),
      }}
      role="region"
      aria-label="Drop zone for modules"
      aria-dropeffect={isDragOver ? (isValidDrop ? 'copy' : 'none') : 'none'}
    >
      {children}
      
      {/* Drop Preview */}
      {isDragOver && dropPreview && dragData && (
        <div
          className="studio-drop-zone__preview"
          style={{
            position: 'absolute',
            left: snapToGrid ? dropPreview.gridX * gridSize : dropPreview.x,
            top: snapToGrid ? dropPreview.gridY * gridSize : dropPreview.y,
            width: (dragData.layout?.defaultWidth || 4) * gridSize,
            height: (dragData.layout?.defaultHeight || 3) * gridSize,
            border: isValidDrop 
              ? '2px dashed var(--studio-preview-valid, #4caf50)'
              : '2px dashed var(--studio-preview-invalid, #f44336)',
            backgroundColor: isValidDrop
              ? 'var(--studio-preview-valid-bg, rgba(76, 175, 80, 0.2))'
              : 'var(--studio-preview-invalid-bg, rgba(244, 67, 54, 0.2))',
            borderRadius: '4px',
            pointerEvents: 'none',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '12px',
            fontWeight: 'bold',
            color: isValidDrop ? '#2e7d32' : '#c62828',
          }}
        >
          {dragData.displayName || dragData.moduleName}
          <br />
          <small>
            {dragData.layout?.defaultWidth || 4}×{dragData.layout?.defaultHeight || 3}
          </small>
        </div>
      )}
      
      {/* Drop Zone Indicator */}
      {isDragOver && showDropZones && (
        <div className="studio-drop-zone__indicator">
          <div className="studio-drop-zone__indicator-content">
            <div className="studio-drop-zone__indicator-icon">
              {isValidDrop ? (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                </svg>
              ) : (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                </svg>
              )}
            </div>
            <div className="studio-drop-zone__indicator-text">
              {isValidDrop 
                ? `Drop ${dragData?.displayName || dragData?.moduleName || 'module'} here`
                : 'Cannot drop here'
              }
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StudioDropZone;