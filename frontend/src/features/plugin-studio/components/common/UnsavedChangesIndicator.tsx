import React from 'react';
import { Box, Typography, Button } from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import { usePluginStudio } from '../../hooks';

/**
 * Component that displays an indicator when there are unsaved changes
 * @returns The unsaved changes indicator component
 */
export const UnsavedChangesIndicator: React.FC = () => {
  const { currentPage, hasPendingChanges, savePageImmediately } = usePluginStudio();
  
  if (!hasPendingChanges || !currentPage) {
    return null;
  }
  
  const handleSaveNow = () => {
    if (currentPage) {
      savePageImmediately(currentPage.id);
    }
  };
  
  return (
    <Box
      sx={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        padding: '8px 16px',
        backgroundColor: 'primary.main',
        color: 'white',
        borderRadius: 2,
        boxShadow: 2,
        animation: 'slideIn 0.3s ease-out',
        '@keyframes slideIn': {
          '0%': {
            transform: 'translateY(100%)',
            opacity: 0
          },
          '100%': {
            transform: 'translateY(0)',
            opacity: 1
          }
        }
      }}
    >
      <Typography variant="body2">Unsaved changes</Typography>
      <Button
        size="small"
        variant="outlined"
        color="inherit"
        startIcon={<SaveIcon />}
        onClick={handleSaveNow}
        sx={{ ml: 1 }}
      >
        Save now
      </Button>
    </Box>
  );
};