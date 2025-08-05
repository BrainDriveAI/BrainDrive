import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ThemeProvider, createTheme } from '@mui/material/styles';

// Import components to test
import { PluginStudioAdapter } from '../utils/PluginStudioAdapter';
import { StudioGridItem } from '../components/studio/StudioGridItem';
import { StudioDropZone } from '../components/studio/StudioDropZone';
import { StudioCanvas } from '../components/studio/StudioCanvas';
import { StudioToolbar } from '../components/studio/StudioToolbar';
import { StudioDialogs } from '../components/studio/StudioDialogs';
import { LayoutEngine } from '../components/LayoutEngine';
import { ModuleRenderer } from '../components/ModuleRenderer';
import { RenderMode } from '../types';

// Mock data
const mockTheme = createTheme();

const mockPageData = {
  id: 'test-page',
  name: 'Test Page',
  route: '/test',
  layouts: {
    mobile: [],
    tablet: [],
    desktop: [],
    wide: [],
  },
  modules: [
    {
      pluginId: 'TestPlugin',
      moduleId: 'TestModule',
      instanceId: 'test-instance-1',
      config: { title: 'Test Module' },
      layoutConfig: { x: 0, y: 0, w: 4, h: 3 },
      services: ['pluginState', 'pageContext'],
    },
  ],
  metadata: {
    title: 'Test Page',
    description: 'Test page for studio integration',
    lastModified: new Date(),
  },
  isPublished: false,
};

const mockBreakpoint = {
  name: 'desktop',
  width: 1200,
  height: 800,
  orientation: 'landscape' as const,
  pixelRatio: 1,
};

const mockPluginInfo = {
  id: 'TestPlugin',
  name: 'Test Plugin',
  description: 'A test plugin for studio integration',
  version: '1.0.0',
  author: 'Test Author',
  category: 'widgets',
  tags: ['test', 'demo'],
  isLocal: true,
  isOfficial: false,
  isEnabled: true,
  lastUpdated: new Date(),
  modules: [
    {
      id: 'TestModule',
      name: 'TestModule',
      displayName: 'Test Module',
      description: 'A test module',
      category: 'widgets',
      tags: ['test'],
      isEnabled: true,
      layout: {
        defaultWidth: 4,
        defaultHeight: 3,
        minWidth: 2,
        minHeight: 2,
        resizable: true,
        draggable: true,
      },
      config: { title: 'Default Title' },
      requiredServices: ['pluginState'],
    },
  ],
};

// Test wrapper component
const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ThemeProvider theme={mockTheme}>
    {children}
  </ThemeProvider>
);

describe('Plugin Studio Integration Tests', () => {
  describe('PluginStudioAdapter', () => {
    test('should adapt legacy plugin module correctly', () => {
      const legacyModule = {
        pluginId: 'TestPlugin',
        moduleId: 'TestModule',
        moduleName: 'Test Module',
        config: { title: 'Test' },
        layoutConfig: { x: 0, y: 0, w: 4, h: 3 },
        services: ['pluginState'],
      };

      const adaptedModule = PluginStudioAdapter.adaptPluginStudioModule(legacyModule);

      expect(adaptedModule).toMatchObject({
        pluginId: 'TestPlugin',
        moduleId: 'TestModule',
        instanceId: expect.stringContaining('TestPlugin_'),
        services: ['pluginState'],
        studioConfig: expect.objectContaining({
          autoSave: true,
          enableDragDrop: true,
          enableResize: true,
        }),
        layoutHints: expect.objectContaining({
          defaultWidth: 4,
          defaultHeight: 3,
        }),
      });
    });

    test('should validate studio compatibility correctly', () => {
      const validModule = {
        pluginId: 'TestPlugin',
        moduleId: 'TestModule',
        services: { pluginState: {} },
      };

      const invalidModule = {
        // Missing required pluginId
        moduleId: 'TestModule',
      };

      const validResult = PluginStudioAdapter.validateStudioCompatibility(validModule);
      const invalidResult = PluginStudioAdapter.validateStudioCompatibility(invalidModule);

      expect(validResult.isCompatible).toBe(true);
      expect(validResult.issues).toHaveLength(0);

      expect(invalidResult.isCompatible).toBe(false);
      expect(invalidResult.issues).toContain('Missing required pluginId property');
    });

    test('should create legacy service bridge correctly', () => {
      const mockServiceBridgeV2 = {
        getService: jest.fn().mockReturnValue({
          configure: jest.fn(),
          saveState: jest.fn(),
          getState: jest.fn(),
        }),
      };

      const serviceBridge = PluginStudioAdapter.createLegacyStudioServiceBridge(
        'TestPlugin',
        'TestModule',
        'test-instance',
        mockServiceBridgeV2,
        ['pluginState']
      );

      expect(serviceBridge).toHaveProperty('pluginState');
      expect(serviceBridge.pluginState).toHaveProperty('saveLayoutState');
      expect(serviceBridge.pluginState).toHaveProperty('getLayoutState');
      expect(mockServiceBridgeV2.getService).toHaveBeenCalledWith('pluginState', {
        pluginId: 'TestPlugin',
        moduleId: 'TestModule',
        instanceId: 'test-instance',
      });
    });
  });

  describe('StudioGridItem', () => {
    const mockModuleConfig = {
      pluginId: 'TestPlugin',
      moduleId: 'TestModule',
      instanceId: 'test-instance',
      config: { title: 'Test' },
      layoutConfig: { x: 0, y: 0, w: 4, h: 3 },
      studioConfig: {
        enableDragDrop: true,
        enableResize: true,
        enableConfigure: true,
        enableDelete: true,
      },
      layoutHints: {
        defaultWidth: 4,
        defaultHeight: 3,
      },
      services: [],
    };

    const mockLayoutItem = {
      i: 'test-instance',
      x: 0,
      y: 0,
      w: 4,
      h: 3,
      moduleId: 'TestModule',
      pluginId: 'TestPlugin',
      config: {},
    };

    test('should render with WYSIWYG controls', () => {
      const mockOnSelect = jest.fn();
      const mockOnConfigure = jest.fn();
      const mockOnRemove = jest.fn();

      render(
        <TestWrapper>
          <StudioGridItem
            moduleConfig={mockModuleConfig}
            layoutItem={mockLayoutItem}
            isSelected={true}
            onSelect={mockOnSelect}
            onConfigure={mockOnConfigure}
            onRemove={mockOnRemove}
            showControls={true}
          />
        </TestWrapper>
      );

      // Should show controls when selected
      expect(screen.getByTitle('Drag to move')).toBeInTheDocument();
      expect(screen.getByTitle('Configure module')).toBeInTheDocument();
      expect(screen.getByTitle('Remove module')).toBeInTheDocument();
    });

    test('should handle selection correctly', () => {
      const mockOnSelect = jest.fn();

      render(
        <TestWrapper>
          <StudioGridItem
            moduleConfig={mockModuleConfig}
            layoutItem={mockLayoutItem}
            onSelect={mockOnSelect}
          />
        </TestWrapper>
      );

      const gridItem = screen.getByRole('gridcell');
      fireEvent.click(gridItem);

      expect(mockOnSelect).toHaveBeenCalledWith('test-instance', false);
    });

    test('should handle keyboard shortcuts', () => {
      const mockOnRemove = jest.fn();
      const mockOnConfigure = jest.fn();

      render(
        <TestWrapper>
          <StudioGridItem
            moduleConfig={mockModuleConfig}
            layoutItem={mockLayoutItem}
            isSelected={true}
            onRemove={mockOnRemove}
            onConfigure={mockOnConfigure}
          />
        </TestWrapper>
      );

      const gridItem = screen.getByRole('gridcell');
      
      // Test Delete key
      fireEvent.keyDown(gridItem, { key: 'Delete' });
      expect(mockOnRemove).toHaveBeenCalledWith('test-instance');

      // Test Enter key
      fireEvent.keyDown(gridItem, { key: 'Enter' });
      expect(mockOnConfigure).toHaveBeenCalledWith('test-instance');
    });
  });

  describe('StudioDropZone', () => {
    test('should handle drag and drop correctly', async () => {
      const mockOnModuleAdd = jest.fn();

      render(
        <TestWrapper>
          <StudioDropZone onModuleAdd={mockOnModuleAdd}>
            <div>Drop zone content</div>
          </StudioDropZone>
        </TestWrapper>
      );

      const dropZone = screen.getByRole('region');

      // Simulate drag enter
      const dragData = {
        type: 'module',
        pluginId: 'TestPlugin',
        moduleId: 'TestModule',
        moduleName: 'Test Module',
        isLocal: true,
        layout: { defaultWidth: 4, defaultHeight: 3 },
      };

      const dragEvent = new DragEvent('dragenter', {
        bubbles: true,
        dataTransfer: new DataTransfer(),
      });
      
      // Mock dataTransfer.getData
      Object.defineProperty(dragEvent, 'dataTransfer', {
        value: {
          getData: jest.fn().mockReturnValue(JSON.stringify(dragData)),
          setData: jest.fn(),
          effectAllowed: 'copy',
          dropEffect: 'copy',
        },
      });

      fireEvent(dropZone, dragEvent);

      // Simulate drop
      const dropEvent = new DragEvent('drop', {
        bubbles: true,
        clientX: 100,
        clientY: 100,
        dataTransfer: dragEvent.dataTransfer,
      });

      fireEvent(dropZone, dropEvent);

      await waitFor(() => {
        expect(mockOnModuleAdd).toHaveBeenCalledWith(
          expect.objectContaining({
            pluginId: 'TestPlugin',
            moduleId: 'TestModule',
            instanceId: expect.stringContaining('TestPlugin_TestModule_'),
          }),
          expect.objectContaining({
            gridX: expect.any(Number),
            gridY: expect.any(Number),
          })
        );
      });
    });
  });

  describe('StudioToolbar', () => {
    test('should render plugin list correctly', () => {
      render(
        <TestWrapper>
          <StudioToolbar
            availablePlugins={[mockPluginInfo]}
            pageData={mockPageData}
          />
        </TestWrapper>
      );

      expect(screen.getByText('Plugins')).toBeInTheDocument();
      expect(screen.getByText('Test Plugin')).toBeInTheDocument();
      expect(screen.getByText('Test Module')).toBeInTheDocument();
    });

    test('should filter plugins correctly', () => {
      render(
        <TestWrapper>
          <StudioToolbar
            availablePlugins={[mockPluginInfo]}
            pageData={mockPageData}
            showSearch={true}
          />
        </TestWrapper>
      );

      const searchInput = screen.getByPlaceholderText('Search plugins and modules...');
      fireEvent.change(searchInput, { target: { value: 'nonexistent' } });

      // Plugin should be filtered out
      expect(screen.queryByText('Test Plugin')).not.toBeInTheDocument();

      // Clear search
      fireEvent.change(searchInput, { target: { value: 'Test' } });
      expect(screen.getByText('Test Plugin')).toBeInTheDocument();
    });
  });

  describe('LayoutEngine Studio Mode', () => {
    test('should render in studio mode with WYSIWYG features', () => {
      render(
        <TestWrapper>
          <LayoutEngine
            layouts={mockPageData.layouts}
            modules={mockPageData.modules}
            mode={RenderMode.STUDIO}
            breakpoint={mockBreakpoint}
            enableDragDrop={true}
            enableResize={true}
            showGrid={true}
          />
        </TestWrapper>
      );

      // Should render the studio layout with grid
      expect(screen.getByText('Start Building Your Page')).toBeInTheDocument();
    });

    test('should render in published mode without WYSIWYG features', () => {
      render(
        <TestWrapper>
          <LayoutEngine
            layouts={mockPageData.layouts}
            modules={mockPageData.modules}
            mode={RenderMode.PUBLISHED}
            breakpoint={mockBreakpoint}
          />
        </TestWrapper>
      );

      // Should not show studio-specific UI
      expect(screen.queryByText('Start Building Your Page')).not.toBeInTheDocument();
    });
  });

  describe('Service Bridge Integration', () => {
    test('should pass services correctly to modules in studio mode', () => {
      const mockServices = ['pluginState', 'pageContext'];
      
      render(
        <TestWrapper>
          <ModuleRenderer
            pluginId="TestPlugin"
            moduleId="TestModule"
            instanceId="test-instance"
            config={{ title: 'Test' }}
            layoutConfig={{
              position: 'relative',
              display: 'block',
              breakpointBehavior: {},
            }}
            mode={RenderMode.STUDIO}
            breakpoint={mockBreakpoint}
            services={mockServices}
          />
        </TestWrapper>
      );

      // Component should render without errors
      expect(screen.getByTestId('unified-page-renderer')).toBeInTheDocument();
    });
  
    describe('Migration Validation Integration', () => {
      it('should run complete migration validation', async () => {
        const { runMigrationValidation } = await import('./MigrationValidationRunner');
        
        // Mock process.exit to prevent test termination
        const originalExit = process.exit;
        let exitCode: number | undefined;
        process.exit = jest.fn((code?: number) => {
          exitCode = code;
          return undefined as never;
        });
  
        try {
          await runMigrationValidation();
          
          // Should exit with success code (0) or warning code (2)
          expect([0, 2]).toContain(exitCode);
        } finally {
          process.exit = originalExit;
        }
      });
  
      it('should validate plugin compatibility', async () => {
        const { PluginCompatibilityValidator } = await import('./PluginCompatibilityValidator');
        
        const results = await PluginCompatibilityValidator.validateExistingPlugins();
        
        expect(results).toBeDefined();
        expect(Object.keys(results).length).toBeGreaterThan(0);
        
        // Check that ServiceExample_PluginState is 100% compatible
        if (results['ServiceExample_PluginState']) {
          expect(results['ServiceExample_PluginState'].isValid).toBe(true);
          expect(results['ServiceExample_PluginState'].serviceCompatibility.servicePatternMatch).toBe(true);
        }
      });
  
      it('should generate comprehensive compatibility report', async () => {
        const { PluginCompatibilityValidator } = await import('./PluginCompatibilityValidator');
        
        const results = await PluginCompatibilityValidator.validateExistingPlugins();
        const report = PluginCompatibilityValidator.generateCompatibilityReport(results);
        
        expect(report).toContain('Plugin Studio Migration - Compatibility Report');
        expect(report).toContain('Summary');
        expect(report).toContain('Migration Status');
        expect(report).toMatch(/\d+% Plugin Compatibility/);
      });
    });
  
    describe('End-to-End Studio Workflow', () => {
      it('should complete full plugin studio workflow', async () => {
        const mockPlugin = {
          id: 'TestWorkflowPlugin',
          name: 'Test Workflow Plugin',
          modules: [{
            id: 'WorkflowModule',
            name: 'Workflow Module',
            requiredServices: ['pluginState', 'api'],
            config: {
              title: 'Test Module',
              description: 'Testing complete workflow',
            },
          }],
        };
  
        // Step 1: Adapt plugin for studio
        const adaptedPlugin = PluginStudioAdapter.adaptPluginStudioModule(mockPlugin);
        expect(adaptedPlugin).toBeDefined();
        expect(adaptedPlugin.studioConfig).toBeDefined();
  
        // Step 2: Create service bridge
        const testServiceBridge = PluginStudioAdapter.createLegacyStudioServiceBridge(
          mockPlugin.id,
          mockPlugin.modules[0].id,
          'workflow-test-instance',
          serviceBridge,
          mockPlugin.modules[0].requiredServices
        );
        expect(testServiceBridge).toBeDefined();
  
        // Step 3: Create mock page data for StudioCanvas
        const mockLayoutItem = {
          i: 'workflow-module-1',
          x: 0,
          y: 0,
          w: 6,
          h: 4,
          moduleId: mockPlugin.modules[0].id,
          pluginId: mockPlugin.id,
          config: mockPlugin.modules[0].config,
        };
  
        const mockPageData = {
          id: 'test-page',
          name: 'Test Page',
          route: '/test-page',
          modules: [{
            id: 'workflow-module-1',
            moduleId: mockPlugin.modules[0].id,
            pluginId: mockPlugin.id,
            instanceId: 'workflow-test-instance',
            config: mockPlugin.modules[0].config,
          }],
          layouts: {
            mobile: [mockLayoutItem],
            tablet: [mockLayoutItem],
            desktop: [mockLayoutItem],
            wide: [mockLayoutItem],
          },
          metadata: {
            title: 'Test Page',
            description: 'Test page for workflow validation',
          },
          isPublished: false,
        };
  
        const mockBreakpoint = {
          name: 'desktop',
          width: 1200,
          height: 800,
          orientation: 'landscape' as const,
          pixelRatio: 1,
          containerWidth: 1200,
          containerHeight: 800,
        };
  
        render(
          <ThemeProvider theme={createTheme()}>
            <StudioCanvas
              pageData={mockPageData}
              currentBreakpoint={mockBreakpoint}
              selectedItems={[]}
              onLayoutChange={jest.fn()}
              onModuleAdd={jest.fn()}
              onModuleRemove={jest.fn()}
              onModuleConfigure={jest.fn()}
              onModuleDuplicate={jest.fn()}
              onItemSelect={jest.fn()}
              onBreakpointChange={jest.fn()}
              showGrid={true}
              enableDragDrop={true}
              enableResize={true}
            />
          </ThemeProvider>
        );
  
        // Verify studio canvas renders
        expect(screen.getByTestId('studio-canvas')).toBeInTheDocument();
        
        // Step 4: Test that modules are rendered
        const moduleElement = screen.getByTestId('module-workflow-module-1');
        expect(moduleElement).toBeInTheDocument();
      });
  
      it('should maintain performance standards', async () => {
        const startTime = performance.now();
        
        // Create complex page data with many modules
        const complexModules = Array.from({ length: 20 }, (_, i) => ({
          id: `perf-module-${i}`,
          moduleId: 'PerfTestModule',
          pluginId: 'PerfTestPlugin',
          instanceId: `perf-instance-${i}`,
          config: { title: `Performance Test ${i}` },
        }));
  
        const createLayoutItems = (modules: any[], cols: number) =>
          modules.map((module, i) => ({
            i: module.id,
            x: i % cols,
            y: Math.floor(i / cols),
            w: Math.floor(12 / cols),
            h: 2,
            moduleId: module.moduleId,
            pluginId: module.pluginId,
            config: module.config,
          }));
  
        const complexLayouts = {
          mobile: createLayoutItems(complexModules, 1),
          tablet: createLayoutItems(complexModules, 2),
          desktop: createLayoutItems(complexModules, 4),
          wide: createLayoutItems(complexModules, 6),
        };
  
        const mockPageData = {
          id: 'perf-test-page',
          name: 'Performance Test Page',
          route: '/perf-test',
          modules: complexModules,
          layouts: complexLayouts,
          metadata: {
            title: 'Performance Test Page',
            description: 'Testing performance with many modules',
          },
          isPublished: false,
        };
  
        const mockBreakpoint = {
          name: 'desktop',
          width: 1200,
          height: 800,
          orientation: 'landscape' as const,
          pixelRatio: 1,
          containerWidth: 1200,
          containerHeight: 800,
        };
  
        render(
          <ThemeProvider theme={createTheme()}>
            <StudioCanvas
              pageData={mockPageData}
              currentBreakpoint={mockBreakpoint}
              selectedItems={[]}
              onLayoutChange={jest.fn()}
              onModuleAdd={jest.fn()}
              onModuleRemove={jest.fn()}
              onModuleConfigure={jest.fn()}
              onModuleDuplicate={jest.fn()}
              onItemSelect={jest.fn()}
              onBreakpointChange={jest.fn()}
              showGrid={true}
              enableDragDrop={true}
              enableResize={true}
            />
          </ThemeProvider>
        );
  
        const renderTime = performance.now() - startTime;
        
        // Should render within performance budget (500ms for 20 modules)
        expect(renderTime).toBeLessThan(500);
        
        // Verify studio canvas renders
        expect(screen.getByTestId('studio-canvas')).toBeInTheDocument();
      });
    });
  });

  describe('Integration Tests', () => {
    test('should integrate all studio components correctly', async () => {
      const mockOnLayoutChange = jest.fn();
      const mockOnModuleAdd = jest.fn();

      render(
        <TestWrapper>
          <StudioCanvas
            pageData={mockPageData}
            currentBreakpoint={mockBreakpoint}
            selectedItems={[]}
            onLayoutChange={mockOnLayoutChange}
            onModuleAdd={mockOnModuleAdd}
            onModuleRemove={jest.fn()}
            onModuleConfigure={jest.fn()}
            onModuleDuplicate={jest.fn()}
            onItemSelect={jest.fn()}
            onBreakpointChange={jest.fn()}
            showGrid={true}
            enableDragDrop={true}
            enableResize={true}
          />
        </TestWrapper>
      );

      // Should render canvas with toolbar
      expect(screen.getByText('100%')).toBeInTheDocument(); // Zoom indicator
      expect(screen.getByTitle('Show Grid (G)')).toBeInTheDocument();
      expect(screen.getByTitle('Enter Preview Mode (P)')).toBeInTheDocument();
    });

    test('should handle complete WYSIWYG workflow', async () => {
      const mockHandlers = {
        onLayoutChange: jest.fn(),
        onModuleAdd: jest.fn(),
        onModuleRemove: jest.fn(),
        onModuleConfigure: jest.fn(),
        onItemSelect: jest.fn(),
      };

      const { rerender } = render(
        <TestWrapper>
          <div style={{ display: 'flex', height: '600px' }}>
            <StudioToolbar
              availablePlugins={[mockPluginInfo]}
              pageData={mockPageData}
              onModuleDragStart={jest.fn()}
            />
            <StudioCanvas
              pageData={mockPageData}
              currentBreakpoint={mockBreakpoint}
              selectedItems={[]}
              {...mockHandlers}
              onModuleDuplicate={jest.fn()}
              onBreakpointChange={jest.fn()}
            />
          </div>
        </TestWrapper>
      );

      // Verify both components render
      expect(screen.getByText('Plugins')).toBeInTheDocument();
      expect(screen.getByText('Test Plugin')).toBeInTheDocument();
      expect(screen.getByText('100%')).toBeInTheDocument();

      // Test adding a module to the page
      const updatedPageData = {
        ...mockPageData,
        modules: [
          ...mockPageData.modules,
          {
            pluginId: 'TestPlugin',
            moduleId: 'TestModule',
            instanceId: 'test-instance-2',
            config: { title: 'New Module' },
            layoutConfig: { x: 4, y: 0, w: 4, h: 3 },
            services: ['pluginState'],
          },
        ],
      };

      rerender(
        <TestWrapper>
          <div style={{ display: 'flex', height: '600px' }}>
            <StudioToolbar
              availablePlugins={[mockPluginInfo]}
              pageData={updatedPageData}
              onModuleDragStart={jest.fn()}
            />
            <StudioCanvas
              pageData={updatedPageData}
              currentBreakpoint={mockBreakpoint}
              selectedItems={[]}
              {...mockHandlers}
              onModuleDuplicate={jest.fn()}
              onBreakpointChange={jest.fn()}
            />
          </div>
        </TestWrapper>
      );

      // Should still render correctly with updated data
      expect(screen.getByText('Plugins')).toBeInTheDocument();
      expect(screen.getByText('100%')).toBeInTheDocument();
    });
  });
});

describe('Plugin Compatibility Tests', () => {
  test('should maintain compatibility with existing plugins', () => {
    // Test with BrainDriveBasicAIChat plugin structure
    const legacyAIChatModule = {
      pluginId: 'BrainDriveBasicAIChat',
      moduleId: 'AIPromptChat',
      moduleName: 'AI Chat',
      config: {
        title: 'AI Assistant',
        placeholder: 'Ask me anything...',
      },
      layoutConfig: { x: 0, y: 0, w: 6, h: 4 },
      services: ['api', 'theme'],
    };

    const adapted = PluginStudioAdapter.adaptPluginStudioModule(legacyAIChatModule);

    expect(adapted).toMatchObject({
      pluginId: 'BrainDriveBasicAIChat',
      moduleId: 'AIPromptChat',
      services: ['api', 'theme'],
      studioConfig: expect.objectContaining({
        enableDragDrop: true,
        enableResize: true,
        enableConfigure: true,
      }),
    });
  });

  test('should handle service bridge patterns correctly', () => {
    // Test the exact pattern from ServiceExample_PluginState
    const serviceExamplePattern = {
      moduleId: 'PluginStateDemo',
      pluginId: 'ServiceExample_PluginState',
      instanceId: 'plugin-state-demo-1',
      services: {
        pluginState: {
          configure: jest.fn(),
          saveState: jest.fn(),
          getState: jest.fn(),
        },
      },
      config: {
        showDebugInfo: true,
        autoSave: true,
        validateState: true,
      },
    };

    // This should work seamlessly with our adapter
    const compatibility = PluginStudioAdapter.validateStudioCompatibility(serviceExamplePattern);
    expect(compatibility.isCompatible).toBe(true);
  });
});