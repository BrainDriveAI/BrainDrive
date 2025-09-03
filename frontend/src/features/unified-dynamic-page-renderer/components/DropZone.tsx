import React, { useRef, useEffect, useState } from 'react';
import { DragData, DropZoneValidation } from '../types/studio';
import { useDragDrop } from '../hooks/useDragDrop';

export interface DropZoneProps {
  id: string;
  accepts?: string[];
  validation?: (data: DragData) => DropZoneValidation;
  className?: string;
  style?: React.CSSProperties;
  
  // Event handlers
  onDrop?: (data: DragData, position: { x: number; y: number }) => void;
  onDragEnter?: (data: DragData) => void;
  onDragLeave?: () => void;
  
  // Visual feedback
  showDropIndicator?: boolean;
  dropIndicatorText?: string;
  
  children: React.ReactNode;
}

/**
 * DropZone component that handles drag and drop operations
 * Integrates with the unified drag-drop system
 */
export const DropZone: React.FC<DropZoneProps> = ({
  id,
  accepts = [],
  validation,
  className = '',
  style = {},
  onDrop,
  onDragEnter,
  onDragLeave,
  showDropIndicator = true,
  dropIndicatorText = 'Drop here',
  children
}) => {
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const [isHovered, setIsHovered] = useState(false);

  const {
    dragDropState,
    registerDropZone,
    isDragActive,
    isActiveDropZone,
    createValidation
  } = useDragDrop({
    dropZoneId: id,
    accepts,
    validation,
    onDrop,
    onDragEnter: (data) => {
      setIsHovered(true);
      onDragEnter?.(data);
    },
    onDragLeave: () => {
      setIsHovered(false);
      onDragLeave?.();
    }
  });

  // Create default validation if none provided
  const finalValidation = validation || createValidation(accepts);

  // Register the drop zone when component mounts
  useEffect(() => {
    if (dropZoneRef.current) {
      return registerDropZone(dropZoneRef.current);
    }
  }, [registerDropZone]);

  // Calculate drop zone classes
  const dropZoneClasses = [
    'unified-drop-zone',
    className,
    isDragActive ? 'unified-drop-zone--drag-active' : '',
    isActiveDropZone ? 'unified-drop-zone--active' : '',
    isHovered ? 'unified-drop-zone--hovered' : ''
  ].filter(Boolean).join(' ');

  // Check if current drag data is acceptable
  const isDragDataAcceptable = () => {
    if (!dragDropState.dragData) return false;
    
    if (accepts.length > 0 && !accepts.includes(dragDropState.dragData.type)) {
      return false;
    }
    
    if (finalValidation) {
      const result = finalValidation(dragDropState.dragData);
      return result.isValid;
    }
    
    return true;
  };

  const canAcceptDrop = isDragActive && isDragDataAcceptable();

  return (
    <div
      ref={dropZoneRef}
      className={dropZoneClasses}
      style={{
        position: 'relative',
        minHeight: '100px',
        ...style
      }}
      data-drop-zone-id={id}
      data-accepts={accepts.join(',')}
      data-can-accept={canAcceptDrop}
    >
      {children}
      
      {/* Drop indicator overlay */}
      {showDropIndicator && isDragActive && (
        <div className="unified-drop-zone__indicator">
          <div 
            className={`unified-drop-zone__indicator-content ${
              canAcceptDrop ? 'unified-drop-zone__indicator-content--valid' : 'unified-drop-zone__indicator-content--invalid'
            }`}
          >
            <div className="unified-drop-zone__indicator-icon">
              {canAcceptDrop ? '✓' : '✗'}
            </div>
            <div className="unified-drop-zone__indicator-text">
              {canAcceptDrop ? dropIndicatorText : 'Cannot drop here'}
            </div>
            {!canAcceptDrop && dragDropState.dragData && finalValidation && (
              <div className="unified-drop-zone__indicator-reason">
                {finalValidation(dragDropState.dragData).reason}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default DropZone;