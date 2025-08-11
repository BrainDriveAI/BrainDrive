import React from 'react';
import { Box, Chip, Typography } from '@mui/material';
import { usePluginStudioDevMode } from '../../../hooks/usePluginStudioDevMode';

interface DebugInfoProps {
  system: 'direct' | 'legacy' | 'unified';
  pageData?: any;
  layouts?: any;
}

export const DebugInfo: React.FC<DebugInfoProps> = ({ system, pageData, layouts }) => {
  const { isPluginStudioDevMode } = usePluginStudioDevMode();
  
  // Keep existing dev mode check AND add Plugin Studio check
  if (import.meta.env.MODE !== 'development' || !isPluginStudioDevMode) {
    return null;
  }

  return (
    <Box sx={{
      position: 'fixed',
      top: 8,
      left: 8,
      zIndex: 9999,
      bgcolor: 'background.paper',
      p: 1,
      borderRadius: 1,
      boxShadow: 2,
      fontSize: '0.75rem'
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Typography variant="caption" sx={{ fontWeight: 'bold' }}>
          Plugin Studio System:
        </Typography>
        <Chip
          label={system.toUpperCase()}
          size="small"
          color={system === 'direct' ? 'success' : system === 'unified' ? 'warning' : 'error'}
          variant="filled"
        />
      </Box>
      
      {pageData && (
        <Typography variant="caption" sx={{ display: 'block' }}>
          Page: {pageData.name || pageData.id || 'Unknown'}
        </Typography>
      )}
      
      {layouts && (
        <Typography variant="caption" sx={{ display: 'block' }}>
          Layouts: D:{layouts.desktop?.length || 0} T:{layouts.tablet?.length || 0} M:{layouts.mobile?.length || 0}
        </Typography>
      )}
    </Box>
  );
};