import React, { useState, useEffect, useCallback } from 'react';
import { RenderMode, PageData } from '../types';
import { StudioFeatures, PublishedFeatures, PreviewFeatures } from '../types/layout';

export interface ModeControllerProps {
  mode: RenderMode;
  onModeChange: (mode: RenderMode) => void;
  pageData: PageData;
  
  // Mode-specific features
  studioFeatures?: StudioFeatures;
  publishedFeatures?: PublishedFeatures;
  previewFeatures?: PreviewFeatures;
  
  // Event handlers
  onFeatureToggle?: (feature: string, enabled: boolean) => void;
  onModeTransition?: (fromMode: RenderMode, toMode: RenderMode) => void;
}

const defaultStudioFeatures: StudioFeatures = {
  dragAndDrop: true,
  resize: true,
  configure: true,
  delete: true,
  toolbar: true,
  contextMenu: true,
  propertyPanel: true,
  undo: true,
  redo: true,
  copy: true,
  paste: true,
  realTimeEditing: false,
  comments: false,
  versionHistory: false
};

const defaultPublishedFeatures: PublishedFeatures = {
  lazyLoading: true,
  caching: true,
  preloading: true,
  metaTags: true,
  structuredData: true,
  sitemap: true,
  pageViews: true,
  userInteractions: true,
  performanceMetrics: true
};

const defaultPreviewFeatures: PreviewFeatures = {
  deviceSimulation: true,
  interactionSimulation: true,
  performanceSimulation: false,
  accessibilityCheck: true,
  responsiveTest: true,
  loadTimeTest: true
};

export const ModeController: React.FC<ModeControllerProps> = ({
  mode,
  onModeChange,
  pageData,
  studioFeatures = defaultStudioFeatures,
  publishedFeatures = defaultPublishedFeatures,
  previewFeatures = defaultPreviewFeatures,
  onFeatureToggle,
  onModeTransition,
}) => {
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [activeFeatures, setActiveFeatures] = useState<Record<string, boolean>>({});

  // Handle mode transitions
  const handleModeChange = useCallback(async (newMode: RenderMode) => {
    if (newMode === mode || isTransitioning) return;

    setIsTransitioning(true);
    
    try {
      // Notify about transition start
      onModeTransition?.(mode, newMode);
      
      // Perform mode-specific cleanup/setup
      await performModeTransition(mode, newMode);
      
      // Change the mode
      onModeChange(newMode);
    } catch (error) {
      console.error('[ModeController] Mode transition failed:', error);
    } finally {
      setIsTransitioning(false);
    }
  }, [mode, isTransitioning, onModeChange, onModeTransition]);

  // Initialize active features based on current mode
  useEffect(() => {
    const features: Record<string, boolean> = {};
    
    switch (mode) {
      case 'studio':
        Object.entries(studioFeatures).forEach(([key, value]) => {
          features[key] = value;
        });
        break;
      case 'published':
        Object.entries(publishedFeatures).forEach(([key, value]) => {
          features[key] = value;
        });
        break;
      case 'preview':
        Object.entries(previewFeatures).forEach(([key, value]) => {
          features[key] = value;
        });
        break;
    }
    
    setActiveFeatures(features);
  }, [mode, studioFeatures, publishedFeatures, previewFeatures]);

  // Toggle feature
  const toggleFeature = useCallback((feature: string) => {
    setActiveFeatures(prev => {
      const newState = !prev[feature];
      onFeatureToggle?.(feature, newState);
      return { ...prev, [feature]: newState };
    });
  }, [onFeatureToggle]);

  // Perform mode-specific transition logic
  const performModeTransition = async (fromMode: RenderMode, toMode: RenderMode): Promise<void> => {
    // Add transition delay for smooth UX
    await new Promise(resolve => setTimeout(resolve, 150));
    
    // Mode-specific transition logic would go here
    console.log(`[ModeController] Transitioning from ${fromMode} to ${toMode}`);
  };

  return (
    <div className={`mode-controller mode-controller--${mode} ${isTransitioning ? 'mode-controller--transitioning' : ''}`}>
      {/* Mode Selector */}
      <div className="mode-controller__selector">
        <button
          className={`mode-controller__mode-button ${mode === 'studio' ? 'active' : ''}`}
          onClick={() => handleModeChange('studio')}
          disabled={isTransitioning}
        >
          Studio
        </button>
        <button
          className={`mode-controller__mode-button ${mode === 'published' ? 'active' : ''}`}
          onClick={() => handleModeChange('published')}
          disabled={isTransitioning}
        >
          Published
        </button>
        <button
          className={`mode-controller__mode-button ${mode === 'preview' ? 'active' : ''}`}
          onClick={() => handleModeChange('preview')}
          disabled={isTransitioning}
        >
          Preview
        </button>
      </div>

      {/* Studio Mode Features */}
      {mode === 'studio' && (
        <div className="mode-controller__studio-features">
          <div className="mode-controller__feature-group">
            <h4>Editing Tools</h4>
            <label>
              <input
                type="checkbox"
                checked={activeFeatures.dragAndDrop}
                onChange={() => toggleFeature('dragAndDrop')}
              />
              Drag & Drop
            </label>
            <label>
              <input
                type="checkbox"
                checked={activeFeatures.resize}
                onChange={() => toggleFeature('resize')}
              />
              Resize
            </label>
            <label>
              <input
                type="checkbox"
                checked={activeFeatures.configure}
                onChange={() => toggleFeature('configure')}
              />
              Configure
            </label>
          </div>
          
          <div className="mode-controller__feature-group">
            <h4>UI Elements</h4>
            <label>
              <input
                type="checkbox"
                checked={activeFeatures.toolbar}
                onChange={() => toggleFeature('toolbar')}
              />
              Toolbar
            </label>
            <label>
              <input
                type="checkbox"
                checked={activeFeatures.contextMenu}
                onChange={() => toggleFeature('contextMenu')}
              />
              Context Menu
            </label>
            <label>
              <input
                type="checkbox"
                checked={activeFeatures.propertyPanel}
                onChange={() => toggleFeature('propertyPanel')}
              />
              Property Panel
            </label>
          </div>
        </div>
      )}
      
      {/* Published Mode Features */}
      {mode === 'published' && (
        <div className="mode-controller__published-features">
          <div className="mode-controller__feature-group">
            <h4>Performance</h4>
            <label>
              <input
                type="checkbox"
                checked={activeFeatures.lazyLoading}
                onChange={() => toggleFeature('lazyLoading')}
              />
              Lazy Loading
            </label>
            <label>
              <input
                type="checkbox"
                checked={activeFeatures.caching}
                onChange={() => toggleFeature('caching')}
              />
              Caching
            </label>
            <label>
              <input
                type="checkbox"
                checked={activeFeatures.preloading}
                onChange={() => toggleFeature('preloading')}
              />
              Preloading
            </label>
          </div>
          
          <div className="mode-controller__feature-group">
            <h4>SEO & Analytics</h4>
            <label>
              <input
                type="checkbox"
                checked={activeFeatures.metaTags}
                onChange={() => toggleFeature('metaTags')}
              />
              Meta Tags
            </label>
            <label>
              <input
                type="checkbox"
                checked={activeFeatures.pageViews}
                onChange={() => toggleFeature('pageViews')}
              />
              Page Views
            </label>
            <label>
              <input
                type="checkbox"
                checked={activeFeatures.performanceMetrics}
                onChange={() => toggleFeature('performanceMetrics')}
              />
              Performance Metrics
            </label>
          </div>
        </div>
      )}
      
      {/* Preview Mode Features */}
      {mode === 'preview' && (
        <div className="mode-controller__preview-features">
          <div className="mode-controller__feature-group">
            <h4>Testing Tools</h4>
            <label>
              <input
                type="checkbox"
                checked={activeFeatures.deviceSimulation}
                onChange={() => toggleFeature('deviceSimulation')}
              />
              Device Simulation
            </label>
            <label>
              <input
                type="checkbox"
                checked={activeFeatures.accessibilityCheck}
                onChange={() => toggleFeature('accessibilityCheck')}
              />
              Accessibility Check
            </label>
            <label>
              <input
                type="checkbox"
                checked={activeFeatures.responsiveTest}
                onChange={() => toggleFeature('responsiveTest')}
              />
              Responsive Test
            </label>
            <label>
              <input
                type="checkbox"
                checked={activeFeatures.loadTimeTest}
                onChange={() => toggleFeature('loadTimeTest')}
              />
              Load Time Test
            </label>
          </div>
        </div>
      )}

      {/* Transition Indicator */}
      {isTransitioning && (
        <div className="mode-controller__transition-indicator">
          <div className="mode-controller__spinner" />
          <span>Switching modes...</span>
        </div>
      )}
    </div>
  );
};

export default ModeController;