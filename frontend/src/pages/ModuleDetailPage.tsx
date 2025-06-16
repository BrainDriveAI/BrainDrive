import React, { useCallback, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Container, Typography, Box, Alert, AlertTitle, CircularProgress } from '@mui/material';
import ModuleDetailHeader from '../features/plugin-manager/components/ModuleDetailHeader';
import ModuleGrid from '../features/plugin-manager/components/ModuleGrid';
import useModuleDetail from '../features/plugin-manager/hooks/useModuleDetail';
import { Module } from '../features/plugin-manager/types';
import { moduleService } from '../features/plugin-manager/services/moduleService';

/**
 * The detail page for a specific module
 */
const ModuleDetailPage: React.FC = () => {
  console.log('ModuleDetailPage rendering');
  const renderCount = useRef(0);
  
  useEffect(() => {
    renderCount.current += 1;
    console.log(`ModuleDetailPage rendered ${renderCount.current} times`);
  });
  
  const { moduleId = '', pluginId = '' } = useParams<{ moduleId: string; pluginId: string }>();
  console.log(`ModuleDetailPage params: pluginId=${pluginId}, moduleId=${moduleId}`);
  
  const navigate = useNavigate();
  
  const { 
    module, 
    plugin, 
    relatedModules, 
    loading, 
    error, 
    toggleModuleStatus 
  } = useModuleDetail(pluginId, moduleId);

  const handleBack = useCallback(() => {
    console.log('Back button clicked');
    navigate('/plugin-manager');
  }, [navigate]);

  const handleToggleStatus = useCallback(async (enabled: boolean) => {
    console.log(`Toggle status to ${enabled}`);
    await toggleModuleStatus(enabled);
  }, [toggleModuleStatus]);

  const handleRelatedModuleClick = useCallback((relatedModule: Module) => {
    console.log(`Related module clicked: ${relatedModule.name}`);
    navigate(`/plugin-manager/${relatedModule.pluginId}/${relatedModule.id}`);
  }, [navigate]);

  const handleUpdatePlugin = useCallback(async () => {
    if (!plugin) return;

    console.log(`Update plugin requested: ${plugin.name}`);
    try {
      await moduleService.updatePlugin(plugin.id);
      // Refresh the page data after successful update
      // window.location.reload();
    } catch (error) {
      console.error('Failed to update plugin:', error);
      throw error;
    }
  }, [plugin]);

  const handleDeletePlugin = useCallback(async () => {
    if (!plugin) return;

    console.log(`Delete plugin requested: ${plugin.name}`);
    try {
      await moduleService.deletePlugin(plugin.id);
      // Navigate back to plugin manager after successful deletion
      navigate('/plugin-manager');
    } catch (error) {
      console.error('Failed to delete plugin:', error);
      throw error;
    }
  }, [plugin, navigate]);

  if (loading) {
    console.log('ModuleDetailPage is loading');
    return (
      <Container maxWidth="xl" sx={{ py: 4, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress />
      </Container>
    );
  }

  if (error) {
    console.log(`ModuleDetailPage error: ${error.message}`);
    return (
      <Container maxWidth="xl" sx={{ py: 4 }}>
        <Alert severity="error">
          <AlertTitle>Error</AlertTitle>
          {error.message}
        </Alert>
      </Container>
    );
  }

  if (!module || !plugin) {
    console.log('Module or plugin not found');
    return (
      <Container maxWidth="xl" sx={{ py: 4 }}>
        <Alert severity="warning">
          <AlertTitle>Module Not Found</AlertTitle>
          The requested module could not be found.
        </Alert>
      </Container>
    );
  }

  console.log(`Rendering module: ${module.name}, plugin: ${plugin.name}`);
  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      <ModuleDetailHeader
        module={module}
        plugin={plugin}
        onBack={handleBack}
        onToggleStatus={handleToggleStatus}
        onUpdate={handleUpdatePlugin}
        onDelete={handleDeletePlugin}
      />
      
      {relatedModules.length > 0 && (
        <Box sx={{ mt: 4 }}>
          <Typography variant="h5" gutterBottom>
            Other Modules in {plugin.name}
          </Typography>
          
          <ModuleGrid
            modules={relatedModules}
            onModuleClick={handleRelatedModuleClick}
            compact={true}
          />
        </Box>
      )}
    </Container>
  );
};

export default ModuleDetailPage;
