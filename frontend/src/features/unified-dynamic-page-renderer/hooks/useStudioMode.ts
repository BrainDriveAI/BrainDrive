import { useState, useCallback, useEffect } from 'react';
import { RenderMode } from '../types';
import { 
  StudioModeFeatures, 
  UseStudioModeReturn,
  StudioConfig 
} from '../types/studio';

const defaultStudioFeatures: StudioModeFeatures = {
  // Core editing capabilities
  dragAndDrop: true,
  resize: true,
  configure: true,
  delete: true,
  
  // UI elements
  toolbar: true,
  contextMenu: true,
  propertyPanel: true,
  gridOverlay: false,
  
  // Advanced features
  undo: true,
  redo: true,
  copy: true,
  paste: true,
  multiSelect: true,
  keyboardShortcuts: true,
  
  // Grid features
  snapToGrid: true,
  gridAlignment: true,
  collisionDetection: true,
  
  // Collaboration
  realTimeEditing: false,
  comments: false,
  versionHistory: false,
  
  // Performance
  autoSave: true,
  previewMode: true
};

export interface UseStudioModeOptions {
  initialMode?: RenderMode;
  studioConfig?: Partial<StudioConfig>;
  onModeChange?: (mode: RenderMode) => void;
  onFeatureToggle?: (feature: keyof StudioModeFeatures, enabled: boolean) => void;
}

/**
 * Hook for managing studio mode state and features
 */
export const useStudioMode = (options: UseStudioModeOptions = {}): UseStudioModeReturn => {
  const {
    initialMode = 'published',
    studioConfig = {},
    onModeChange,
    onFeatureToggle
  } = options;

  // State
  const [mode, setMode] = useState<RenderMode>(initialMode);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [features, setFeatures] = useState<StudioModeFeatures>({
    ...defaultStudioFeatures,
    ...studioConfig.features
  });

  // Switch mode with transition handling
  const switchMode = useCallback(async (newMode: RenderMode): Promise<void> => {
    if (newMode === mode || isTransitioning) return;

    setIsTransitioning(true);
    
    try {
      // Perform any async operations needed for mode transition
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Update mode
      setMode(newMode);
      
      // Notify external handler
      onModeChange?.(newMode);
      
      // Mode-specific feature adjustments
      if (newMode === 'studio') {
        // Enable all studio features when entering studio mode
        setFeatures(prev => ({
          ...prev,
          ...defaultStudioFeatures,
          ...studioConfig.features
        }));
      } else if (newMode === 'published') {
        // Disable editing features in published mode
        setFeatures(prev => ({
          ...prev,
          dragAndDrop: false,
          resize: false,
          configure: false,
          delete: false,
          toolbar: false,
          contextMenu: false,
          propertyPanel: false,
          undo: false,
          redo: false,
          copy: false,
          paste: false,
          multiSelect: false,
          gridOverlay: false
        }));
      } else if (newMode === 'preview') {
        // Enable limited features in preview mode
        setFeatures(prev => ({
          ...prev,
          dragAndDrop: false,
          resize: false,
          configure: false,
          delete: false,
          toolbar: false,
          contextMenu: false,
          propertyPanel: false,
          undo: false,
          redo: false,
          copy: false,
          paste: false,
          multiSelect: false,
          gridOverlay: false,
          previewMode: true
        }));
      }
      
    } catch (error) {
      console.error('[useStudioMode] Mode transition failed:', error);
    } finally {
      setIsTransitioning(false);
    }
  }, [mode, isTransitioning, onModeChange, studioConfig.features]);

  // Toggle individual features
  const toggleFeature = useCallback((feature: keyof StudioModeFeatures) => {
    setFeatures(prev => {
      const newState = !prev[feature];
      
      // Notify external handler
      onFeatureToggle?.(feature, newState);
      
      return { ...prev, [feature]: newState };
    });
  }, [onFeatureToggle]);

  // Check if a feature is enabled
  const isFeatureEnabled = useCallback((feature: keyof StudioModeFeatures): boolean => {
    return features[feature];
  }, [features]);

  // Update features when config changes
  useEffect(() => {
    if (studioConfig.features) {
      setFeatures(prev => ({
        ...prev,
        ...studioConfig.features
      }));
    }
  }, [studioConfig.features]);

  return {
    mode,
    features,
    isTransitioning,
    switchMode,
    toggleFeature,
    isFeatureEnabled
  };
};

export default useStudioMode;