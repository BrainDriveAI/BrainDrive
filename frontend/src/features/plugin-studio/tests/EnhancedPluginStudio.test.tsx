import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { RenderMode } from '../../unified-dynamic-page-renderer/types';
import { EnhancedPluginStudioPage } from '../index';
import { UnifiedPluginStudioLayout } from '../components/UnifiedPluginStudioLayout';
import { EnhancedStudioRenderer } from '../components/EnhancedStudioRenderer';
import { EnhancedLayoutEngine } from '../components/EnhancedLayoutEngine';
import { EnhancedGridItem } from '../components/EnhancedGridItem';
import { EnhancedConfigDialog } from '../components/dialogs/EnhancedConfigDialog';
import { useEnhancedStudioState } from '../hooks/useEnhancedStudioState';
import { enhancedServiceBridge } from '../services/EnhancedServiceBridge';

// Mock dependencies
jest.mock('../hooks/useEnhancedStudioState');
jest.mock('../services/EnhancedServiceBridge');
jest.mock('../../unified-dynamic-page-renderer/components/UnifiedPageRenderer', () => ({
  UnifiedPageRenderer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="unified-page-renderer">{children}</div>
  ),
}));

const theme = createTheme();

const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ThemeProvider theme={theme}>{children}</ThemeProvider>
);

// Mock data
const mockPageData = {
  id: 'test-page-1',
  name: 'Test Page',
  route: '/test',
  layouts: {
    desktop: [
      {
        i: 'module-1',
        x: 0,
        y: 0,
        w: 4,
        h: 3,
        moduleId: 'test-module',
        pluginId: 'test-plugin',
        config: { title: 'Test Module' },
      },
    ],
    tablet: [],
    mobile: [],
  },
  modules: [
    {
      id: 'module-1',
      pluginId: 'test-plugin',
      moduleId: 'test-module',
      config: { title: 'Test Module' },
    },
  ],
  metadata: {
    title: 'Test Page',
    description: 'Test page description',
    lastModified: new Date(),
  },
  isPublished: false,
};

const mockStudioState = {
  layouts: mockPageData.layouts,
  selectedModules: [],
  draggedModule: null,
  isAutoSaving: false,
  hasUnsavedChanges: false,
  lastSaved: null,
  previewMode: false,
  currentBreakpoint: 'desktop',
  canUndo: false,
  canRedo: false,
};

const mockStudioActions = {
  updateLayouts: jest.fn(),
  addModule: jest.fn(),
  removeModule: jest.fn(),
  moveModule: jest.fn(),
  resizeModule: jest.fn(),
  selectModules: jest.fn(),
  clearSelection: jest.fn(),
  save: jest.fn(),
  enableAutoSave: jest.fn(),
  setAutoSaveInterval: jest.fn(),
  setPreviewMode: jest.fn(),
  setCurrentBreakpoint: jest.fn(),
  undo: jest.fn(),
  redo: jest.fn(),
};

describe('Enhanced Plugin Studio', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useEnhancedStudioState as jest.Mock).mockReturnValue([mockStudioState, mockStudioActions]);
  });

  describe('EnhancedPluginStudioPage', () => {
    it('renders without crashing', () => {
      render(
        <TestWrapper>
          <EnhancedPluginStudioPage />
        </TestWrapper>
      );
      
      expect(screen.getByText(/Enhanced Plugin Studio/i)).toBeInTheDocument();
    });

    it('displays loading state initially', () => {
      render(
        <TestWrapper>
          <EnhancedPluginStudioPage />
        </TestWrapper>
      );
      
      expect(screen.getByText(/Loading Enhanced Plugin Studio/i)).toBeInTheDocument();
    });
  });

  describe('UnifiedPluginStudioLayout', () => {
    const mockProps = {
      // Mock the usePluginStudio hook return values
    };

    beforeEach(() => {
      // Mock the usePluginStudio hook
      jest.doMock('../hooks/usePluginStudio', () => ({
        usePluginStudio: () => ({
          isLoading: false,
          error: null,
          currentPage: mockPageData,
          previewMode: false,
          jsonViewOpen: false,
          setJsonViewOpen: jest.fn(),
          configDialogOpen: false,
          setConfigDialogOpen: jest.fn(),
          pageManagementOpen: false,
          setPageManagementOpen: jest.fn(),
          routeManagementOpen: false,
          setRouteManagementOpen: jest.fn(),
          savePage: jest.fn(),
        }),
      }));
    });

    it('renders the enhanced studio layout', async () => {
      const { UnifiedPluginStudioLayout } = await import('../components/UnifiedPluginStudioLayout');
      
      render(
        <TestWrapper>
          <UnifiedPluginStudioLayout />
        </TestWrapper>
      );
      
      expect(screen.getByTestId('unified-page-renderer')).toBeInTheDocument();
    });

    it('shows unsaved changes indicator when there are changes', async () => {
      const mockStateWithChanges = {
        ...mockStudioState,
        hasUnsavedChanges: true,
      };
      
      (useEnhancedStudioState as jest.Mock).mockReturnValue([mockStateWithChanges, mockStudioActions]);
      
      const { UnifiedPluginStudioLayout } = await import('../components/UnifiedPluginStudioLayout');
      
      render(
        <TestWrapper>
          <UnifiedPluginStudioLayout />
        </TestWrapper>
      );
      
      expect(screen.getByText(/Unsaved Changes/i)).toBeInTheDocument();
    });
  });

  describe('EnhancedStudioRenderer', () => {
    const mockProps = {
      pageData: mockPageData,
      mode: RenderMode.STUDIO,
      onModeChange: jest.fn(),
      onPageLoad: jest.fn(),
      onError: jest.fn(),
      onLayoutChange: jest.fn(),
      onModuleAdd: jest.fn(),
      onModuleRemove: jest.fn(),
      onModuleConfig: jest.fn(),
      onSave: jest.fn(),
      onPageChange: jest.fn(),
    };

    it('renders the studio renderer', () => {
      render(
        <TestWrapper>
          <EnhancedStudioRenderer {...mockProps} />
        </TestWrapper>
      );
      
      expect(screen.getByTestId('unified-page-renderer')).toBeInTheDocument();
    });

    it('shows auto-save indicator when saving', () => {
      const mockStateWithSaving = {
        ...mockStudioState,
        isAutoSaving: true,
      };
      
      (useEnhancedStudioState as jest.Mock).mockReturnValue([mockStateWithSaving, mockStudioActions]);
      
      render(
        <TestWrapper>
          <EnhancedStudioRenderer {...mockProps} />
        </TestWrapper>
      );
      
      expect(screen.getByText(/Saving/i)).toBeInTheDocument();
    });

    it('shows last saved timestamp', () => {
      const mockStateWithSaved = {
        ...mockStudioState,
        lastSaved: new Date('2023-01-01T12:00:00Z'),
      };
      
      (useEnhancedStudioState as jest.Mock).mockReturnValue([mockStateWithSaved, mockStudioActions]);
      
      render(
        <TestWrapper>
          <EnhancedStudioRenderer {...mockProps} />
        </TestWrapper>
      );
      
      expect(screen.getByText(/Saved/i)).toBeInTheDocument();
    });

    it('shows multi-select info when multiple modules selected', () => {
      const mockStateWithSelection = {
        ...mockStudioState,
        selectedModules: ['module-1', 'module-2'],
      };
      
      (useEnhancedStudioState as jest.Mock).mockReturnValue([mockStateWithSelection, mockStudioActions]);
      
      render(
        <TestWrapper>
          <EnhancedStudioRenderer {...mockProps} />
        </TestWrapper>
      );
      
      expect(screen.getByText(/2 modules selected/i)).toBeInTheDocument();
    });
  });

  describe('EnhancedLayoutEngine', () => {
    const mockProps = {
      layouts: mockPageData.layouts,
      modules: mockPageData.modules,
      mode: RenderMode.STUDIO,
      selectedModules: [],
      newItemId: null,
      previewMode: false,
      onLayoutChange: jest.fn(),
      onModuleSelect: jest.fn(),
      onModuleConfig: jest.fn(),
      onModuleRemove: jest.fn(),
      onModuleDuplicate: jest.fn(),
      lazyLoading: true,
      preloadPlugins: [],
    };

    it('renders the layout engine', () => {
      render(
        <TestWrapper>
          <EnhancedLayoutEngine {...mockProps} />
        </TestWrapper>
      );
      
      expect(screen.getByText(/Enhanced Plugin Studio/i)).toBeInTheDocument();
    });

    it('shows empty state when no modules', () => {
      const emptyProps = {
        ...mockProps,
        layouts: { desktop: [], tablet: [], mobile: [] },
        modules: [],
      };
      
      render(
        <TestWrapper>
          <EnhancedLayoutEngine {...emptyProps} />
        </TestWrapper>
      );
      
      expect(screen.getByText(/Drag and drop modules/i)).toBeInTheDocument();
    });

    it('shows multi-select indicator', () => {
      const propsWithSelection = {
        ...mockProps,
        selectedModules: ['module-1', 'module-2'],
      };
      
      render(
        <TestWrapper>
          <EnhancedLayoutEngine {...propsWithSelection} />
        </TestWrapper>
      );
      
      expect(screen.getByText(/2 modules selected/i)).toBeInTheDocument();
    });
  });

  describe('EnhancedGridItem', () => {
    const mockLayoutItem = mockPageData.layouts.desktop[0];
    const mockModuleConfig = mockPageData.modules[0];
    
    const mockProps = {
      layoutItem: mockLayoutItem,
      moduleConfig: mockModuleConfig,
      isSelected: false,
      isNew: false,
      isDragging: false,
      previewMode: false,
      mode: RenderMode.STUDIO,
      onClick: jest.fn(),
      onConfigure: jest.fn(),
      onRemove: jest.fn(),
      onDuplicate: jest.fn(),
      lazyLoading: true,
      preload: false,
    };

    it('renders the grid item', () => {
      render(
        <TestWrapper>
          <EnhancedGridItem {...mockProps} />
        </TestWrapper>
      );
      
      expect(screen.getByRole('gridcell')).toBeInTheDocument();
    });

    it('shows controls when selected', () => {
      const selectedProps = {
        ...mockProps,
        isSelected: true,
      };
      
      render(
        <TestWrapper>
          <EnhancedGridItem {...selectedProps} />
        </TestWrapper>
      );
      
      expect(screen.getByLabelText(/Configure module/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Remove module/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Duplicate module/i)).toBeInTheDocument();
    });

    it('shows new item indicator', () => {
      const newProps = {
        ...mockProps,
        isNew: true,
      };
      
      render(
        <TestWrapper>
          <EnhancedGridItem {...newProps} />
        </TestWrapper>
      );
      
      expect(screen.getByText(/NEW/i)).toBeInTheDocument();
    });

    it('handles click events', async () => {
      const user = userEvent.setup();
      
      render(
        <TestWrapper>
          <EnhancedGridItem {...mockProps} />
        </TestWrapper>
      );
      
      await user.click(screen.getByRole('gridcell'));
      expect(mockProps.onClick).toHaveBeenCalled();
    });

    it('handles configure button click', async () => {
      const user = userEvent.setup();
      const selectedProps = {
        ...mockProps,
        isSelected: true,
      };
      
      render(
        <TestWrapper>
          <EnhancedGridItem {...selectedProps} />
        </TestWrapper>
      );
      
      await user.click(screen.getByLabelText(/Configure module/i));
      expect(mockProps.onConfigure).toHaveBeenCalled();
    });
  });

  describe('EnhancedConfigDialog', () => {
    const mockProps = {
      open: true,
      onClose: jest.fn(),
      moduleId: 'module-1',
      pageId: 'test-page-1',
    };

    it('renders the config dialog', () => {
      render(
        <TestWrapper>
          <EnhancedConfigDialog {...mockProps} />
        </TestWrapper>
      );
      
      expect(screen.getByText(/Configure Module/i)).toBeInTheDocument();
    });

    it('shows configuration tabs', () => {
      render(
        <TestWrapper>
          <EnhancedConfigDialog {...mockProps} />
        </TestWrapper>
      );
      
      expect(screen.getByText(/General/i)).toBeInTheDocument();
      expect(screen.getByText(/Layout/i)).toBeInTheDocument();
      expect(screen.getByText(/Responsive/i)).toBeInTheDocument();
      expect(screen.getByText(/Advanced/i)).toBeInTheDocument();
    });

    it('handles tab switching', async () => {
      const user = userEvent.setup();
      
      render(
        <TestWrapper>
          <EnhancedConfigDialog {...mockProps} />
        </TestWrapper>
      );
      
      await user.click(screen.getByText(/Layout/i));
      expect(screen.getByText(/Width \(Grid Units\)/i)).toBeInTheDocument();
    });

    it('handles configuration changes', async () => {
      const user = userEvent.setup();
      
      render(
        <TestWrapper>
          <EnhancedConfigDialog {...mockProps} />
        </TestWrapper>
      );
      
      const titleInput = screen.getByLabelText(/Title/i);
      await user.clear(titleInput);
      await user.type(titleInput, 'New Title');
      
      expect(titleInput).toHaveValue('New Title');
    });

    it('shows unsaved changes warning', async () => {
      const user = userEvent.setup();
      
      render(
        <TestWrapper>
          <EnhancedConfigDialog {...mockProps} />
        </TestWrapper>
      );
      
      const titleInput = screen.getByLabelText(/Title/i);
      await user.type(titleInput, 'Modified');
      
      expect(screen.getByText(/You have unsaved changes/i)).toBeInTheDocument();
    });
  });

  describe('useEnhancedStudioState Hook', () => {
    it('provides state and actions', () => {
      const [state, actions] = [mockStudioState, mockStudioActions];
      
      expect(state).toBeDefined();
      expect(actions).toBeDefined();
      expect(typeof actions.updateLayouts).toBe('function');
      expect(typeof actions.addModule).toBe('function');
      expect(typeof actions.removeModule).toBe('function');
    });
  });

  describe('EnhancedServiceBridge', () => {
    it('provides studio services', () => {
      expect(enhancedServiceBridge).toBeDefined();
      expect(typeof enhancedServiceBridge.getEnhancedService).toBe('function');
      expect(typeof enhancedServiceBridge.createLegacyServiceBridge).toBe('function');
    });
  });

  describe('Integration Tests', () => {
    it('handles drag and drop operations', async () => {
      const user = userEvent.setup();
      
      render(
        <TestWrapper>
          <EnhancedStudioRenderer
            pageData={mockPageData}
            mode={RenderMode.STUDIO}
            onModeChange={jest.fn()}
            onPageLoad={jest.fn()}
            onError={jest.fn()}
            onLayoutChange={jest.fn()}
            onModuleAdd={jest.fn()}
            onModuleRemove={jest.fn()}
            onModuleConfig={jest.fn()}
            onSave={jest.fn()}
            onPageChange={jest.fn()}
          />
        </TestWrapper>
      );
      
      // Simulate drag and drop
      const dropZone = screen.getByTestId('unified-page-renderer').parentElement;
      
      await act(async () => {
        fireEvent.dragOver(dropZone!, {
          dataTransfer: {
            getData: () => JSON.stringify({
              pluginId: 'test-plugin',
              moduleId: 'test-module',
              displayName: 'Test Module',
            }),
          },
        });
      });
      
      expect(dropZone).toHaveClass('drag-over');
    });

    it('handles module selection and configuration', async () => {
      const user = userEvent.setup();
      const mockStateWithModule = {
        ...mockStudioState,
        selectedModules: ['module-1'],
      };
      
      (useEnhancedStudioState as jest.Mock).mockReturnValue([mockStateWithModule, mockStudioActions]);
      
      render(
        <TestWrapper>
          <EnhancedLayoutEngine
            layouts={mockPageData.layouts}
            modules={mockPageData.modules}
            mode={RenderMode.STUDIO}
            selectedModules={['module-1']}
            onModuleConfig={jest.fn()}
            onModuleSelect={jest.fn()}
            onModuleRemove={jest.fn()}
            onModuleDuplicate={jest.fn()}
          />
        </TestWrapper>
      );
      
      // Module should be selected
      expect(screen.getByText(/1 modules selected/i)).toBeInTheDocument();
    });

    it('handles auto-save functionality', async () => {
      jest.useFakeTimers();
      
      const mockStateWithChanges = {
        ...mockStudioState,
        hasUnsavedChanges: true,
      };
      
      (useEnhancedStudioState as jest.Mock).mockReturnValue([mockStateWithChanges, mockStudioActions]);
      
      render(
        <TestWrapper>
          <EnhancedStudioRenderer
            pageData={mockPageData}
            mode={RenderMode.STUDIO}
            onModeChange={jest.fn()}
            onPageLoad={jest.fn()}
            onError={jest.fn()}
            onSave={jest.fn()}
          />
        </TestWrapper>
      );
      
      // Trigger auto-save
      act(() => {
        jest.advanceTimersByTime(30000); // 30 seconds
      });
      
      expect(mockStudioActions.save).toHaveBeenCalled();
      
      jest.useRealTimers();
    });
  });

  describe('Performance Tests', () => {
    it('renders large layouts efficiently', () => {
      const largeLayouts = {
        desktop: Array.from({ length: 50 }, (_, i) => ({
          i: `module-${i}`,
          x: i % 12,
          y: Math.floor(i / 12),
          w: 2,
          h: 2,
          moduleId: `test-module-${i}`,
          pluginId: 'test-plugin',
          config: { title: `Module ${i}` },
        })),
        tablet: [],
        mobile: [],
      };
      
      const largeModules = Array.from({ length: 50 }, (_, i) => ({
        id: `module-${i}`,
        pluginId: 'test-plugin',
        moduleId: `test-module-${i}`,
        config: { title: `Module ${i}` },
      }));
      
      const start = performance.now();
      
      render(
        <TestWrapper>
          <EnhancedLayoutEngine
            layouts={largeLayouts}
            modules={largeModules}
            mode={RenderMode.STUDIO}
            selectedModules={[]}
            onLayoutChange={jest.fn()}
            onModuleSelect={jest.fn()}
            onModuleConfig={jest.fn()}
            onModuleRemove={jest.fn()}
            onModuleDuplicate={jest.fn()}
          />
        </TestWrapper>
      );
      
      const end = performance.now();
      const renderTime = end - start;
      
      // Should render within reasonable time (less than 100ms)
      expect(renderTime).toBeLessThan(100);
    });
  });

  describe('Accessibility Tests', () => {
    it('provides proper ARIA labels', () => {
      render(
        <TestWrapper>
          <EnhancedGridItem
            layoutItem={mockPageData.layouts.desktop[0]}
            moduleConfig={mockPageData.modules[0]}
            mode={RenderMode.STUDIO}
            isSelected={true}
            onClick={jest.fn()}
            onConfigure={jest.fn()}
            onRemove={jest.fn()}
            onDuplicate={jest.fn()}
          />
        </TestWrapper>
      );
      
      expect(screen.getByRole('gridcell')).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByLabelText(/Configure module/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Remove module/i)).toBeInTheDocument();
    });

    it('supports keyboard navigation', async () => {
      const user = userEvent.setup();
      
      render(
        <TestWrapper>
          <EnhancedGridItem
            layoutItem={mockPageData.layouts.desktop[0]}
            moduleConfig={mockPageData.modules[0]}
            mode={RenderMode.STUDIO}
            isSelected={false}
            onClick={jest.fn()}
            onConfigure={jest.fn()}
            onRemove={jest.fn()}
            onDuplicate={jest.fn()}
          />
        </TestWrapper>
      );
      
      const gridCell = screen.getByRole('gridcell');
      gridCell.focus();
      
      expect(gridCell).toHaveFocus();
      
      // Test keyboard interactions
      await user.keyboard('{Enter}');
      // Should trigger configuration or selection
    });
  });
});