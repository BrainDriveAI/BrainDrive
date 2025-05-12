import React from 'react';
import { Grid, Box, CircularProgress, Typography, Pagination } from '@mui/material';
import { Module } from '../types';
import ModuleCard from './ModuleCard';

interface ModuleGridProps {
  modules: Module[];
  onModuleClick?: (module: Module) => void;
  onToggleStatus?: (module: Module, enabled: boolean) => void;
  loading?: boolean;
  compact?: boolean;
  pagination?: {
    page: number;
    pageSize: number;
    totalItems: number;
    onPageChange: (page: number) => void;
  };
}

/**
 * A grid component for displaying multiple module cards
 */
export const ModuleGrid: React.FC<ModuleGridProps> = ({
  modules,
  onModuleClick,
  onToggleStatus,
  loading = false,
  compact = false,
  pagination
}) => {
  const handlePageChange = (_event: React.ChangeEvent<unknown>, value: number) => {
    if (pagination) {
      pagination.onPageChange(value);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', p: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (modules.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', p: 4 }}>
        <Typography variant="h6" color="text.secondary">
          No modules found
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Try adjusting your search or filters
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ width: '100%' }}>
      <Grid container spacing={2}>
        {modules.map((module) => (
          <Grid 
            item 
            key={`${module.pluginId}-${module.id}`} 
            xs={12} 
            sm={6} 
            md={compact ? 4 : 3}
          >
            <ModuleCard
              module={module}
              onClick={onModuleClick}
              onToggleStatus={onToggleStatus}
              compact={compact}
            />
          </Grid>
        ))}
      </Grid>
      
      {pagination && pagination.totalItems > pagination.pageSize && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
          <Pagination
            count={Math.ceil(pagination.totalItems / pagination.pageSize)}
            page={pagination.page}
            onChange={handlePageChange}
            color="primary"
            showFirstButton
            showLastButton
          />
        </Box>
      )}
    </Box>
  );
};

export default ModuleGrid;
