import React from 'react';
import {
  Box,
  Typography,
  Grid,
  Chip
} from '@mui/material';
import { IconResolver } from '../../common';

interface ConfigDialogHeaderProps {
  moduleDef: any;
  pluginDef: any;
}

export const ConfigDialogHeader = ({ moduleDef, pluginDef }: ConfigDialogHeaderProps) => {
  if (!moduleDef) {
    return null;
  }

  return (
    <Box sx={{ mb: 3 }}>
      <Grid container spacing={2} alignItems="center">
        <Grid item>
          <IconResolver
            icon={moduleDef.icon || pluginDef?.icon}
            sx={{ fontSize: 40 }}
          />
        </Grid>
        <Grid item xs>
          <Typography variant="h6">
            {moduleDef.name || moduleDef.displayName || moduleDef.title || 'Module Configuration'}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {moduleDef.description || pluginDef?.description || 'Configure this module'}
          </Typography>
          {moduleDef.tags && moduleDef.tags.length > 0 && (
            <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {moduleDef.tags.map((tag: string) => (
                <Chip 
                  key={tag} 
                  label={tag} 
                  size="small" 
                  variant="outlined" 
                />
              ))}
            </Box>
          )}
        </Grid>
      </Grid>
    </Box>
  );
};