import React, { useState, useMemo } from 'react';
import { PluginStudioContext } from './PluginStudioContext';
import { usePages } from '../hooks/page/usePages';
import { useLayout } from '../hooks/layout/useLayout';
import { useViewMode } from '../hooks/ui/useViewMode';
import { usePlugins } from '../hooks/plugin/usePlugins';
import { PluginProvider } from '../../../contexts/PluginContext';
import { ToolbarProvider } from './ToolbarContext';

/**
 * Provider component for the PluginStudio context
 * @param children The child components
 * @returns The provider component
 */
export const PluginStudioProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Page state
  const {
    pages,
    currentPage,
    setCurrentPage,
    isLoading,
    error,
    createPage,
    deletePage,
    renamePage,
    savePage,
    publishPage,
    backupPage,
    restorePage,
    updatePage
  } = usePages();
  // Ensure currentPage has layouts and modules
  React.useEffect(() => {
    if (currentPage) {
      // console.log('Current page in PluginStudioProvider:', currentPage);
      // console.log('Current page layouts:', currentPage.layouts);
      // console.log('Current page content.layouts:', currentPage.content?.layouts);
      // console.log('Current page modules:', currentPage.modules);
      
      // Log the reference to help debug object identity issues
      // console.log('Current page reference:', Object.prototype.toString.call(currentPage));
    }
  }, [currentPage]);
  
  // Get plugins
  const { getModuleById } = usePlugins();
  
  // Layout state
  const {
    layouts,
    handleLayoutChange,
    removeItem,
    handleResizeStart,
    handleResizeStop
  } = useLayout(currentPage, getModuleById);
  // View mode state
  const {
    viewMode,
    setViewMode,
    previewMode,
    togglePreviewMode
  } = useViewMode();
  
  // Plugin state
  const { availablePlugins } = usePlugins();
  
  // Selection state
  const [selectedItem, setSelectedItem] = useState<{ i: string } | null>(null);
  
  // Dialog state
  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const [jsonViewOpen, setJsonViewOpen] = useState(false);
  const [pageManagementOpen, setPageManagementOpen] = useState(false);
  const [routeManagementOpen, setRouteManagementOpen] = useState(false);
  
  // Create the context value
  const contextValue = useMemo(() => ({
    // Page state
    pages,
    currentPage,
    setCurrentPage,
    createPage,
    deletePage,
    renamePage,
    savePage,
    publishPage,
    backupPage,
    restorePage,
    updatePage,
    
    // Layout state
    layouts,
    handleLayoutChange,
    removeItem,
    handleResizeStart,
    handleResizeStop,
    
    // Plugin state
    availablePlugins,
    
    // View mode state
    viewMode,
    setViewMode,
    previewMode,
    togglePreviewMode,
    
    // Selection state
    selectedItem,
    setSelectedItem,
    
    // Dialog state
    configDialogOpen,
    setConfigDialogOpen,
    jsonViewOpen,
    setJsonViewOpen,
    pageManagementOpen,
    setPageManagementOpen,
    routeManagementOpen,
    setRouteManagementOpen,
    
    // Loading state
    isLoading,
    error
  }), [
    // Page state
    pages, currentPage, setCurrentPage, createPage, deletePage, renamePage,
    savePage, publishPage, backupPage, restorePage, updatePage,
    
    // Layout state
    layouts, handleLayoutChange, removeItem, handleResizeStart, handleResizeStop,
    
    // Plugin state
    availablePlugins,
    
    // View mode state
    viewMode, setViewMode, previewMode, togglePreviewMode,
    
    // Selection state
    selectedItem, setSelectedItem,
    
    // Dialog state
    configDialogOpen, jsonViewOpen, pageManagementOpen, routeManagementOpen,
    
    // Loading state
    isLoading, error
  ]);
  
  return (
    <PluginStudioContext.Provider value={contextValue}>
      <PluginProvider plugins={availablePlugins}>
        <ToolbarProvider>
          {children}
        </ToolbarProvider>
      </PluginProvider>
    </PluginStudioContext.Provider>
  );
};