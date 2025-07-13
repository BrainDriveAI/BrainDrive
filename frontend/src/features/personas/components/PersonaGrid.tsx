import React from 'react';
import { Grid, Box, CircularProgress, Typography, Pagination } from '@mui/material';
import { Persona } from '../types';
import PersonaCard from './PersonaCard';

interface PersonaGridProps {
  personas: Persona[];
  onPersonaClick?: (persona: Persona) => void;
  onToggleStatus?: (persona: Persona, enabled: boolean) => void;
  onDelete?: (persona: Persona) => void;
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
 * A grid component for displaying multiple persona cards
 */
export const PersonaGrid: React.FC<PersonaGridProps> = ({
  personas,
  onPersonaClick,
  onToggleStatus,
  onDelete,
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

  if (personas.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', p: 4 }}>
        <Typography variant="h6" color="text.secondary">
          No personas found
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Try adjusting your search or filters, or create your first persona
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ width: '100%' }}>
      <Grid container spacing={2}>
        {personas.map((persona) => (
          <Grid 
            item 
            key={persona.id} 
            xs={12} 
            sm={6} 
            md={compact ? 4 : 3}
          >
            <PersonaCard
              persona={persona}
              onClick={onPersonaClick}
              onToggleStatus={onToggleStatus}
              onDelete={onDelete}
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

export default PersonaGrid;