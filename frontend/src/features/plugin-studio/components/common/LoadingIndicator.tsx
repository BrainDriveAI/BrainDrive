import React from 'react';
import { Box, CircularProgress, Typography, useTheme } from '@mui/material';

interface LoadingIndicatorProps {
  message?: string;
  size?: 'small' | 'medium' | 'large';
  fullScreen?: boolean;
  transparent?: boolean;
}

/**
 * Component that displays a loading indicator with an optional message
 * @param props The component props
 * @returns The loading indicator component
 */
export const LoadingIndicator: React.FC<LoadingIndicatorProps> = ({
  message = 'Loading...',
  size = 'medium',
  fullScreen = false,
  transparent = false
}) => {
  const theme = useTheme();
  
  // Determine the size of the CircularProgress
  const progressSize = size === 'small' ? 24 : size === 'large' ? 60 : 40;
  
  // Determine the variant of the Typography
  const textVariant = size === 'small' ? 'caption' : size === 'large' ? 'h6' : 'body1';
  
  // Base styles for the container
  const containerStyles = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing(2),
    padding: theme.spacing(3),
    backgroundColor: transparent ? 'transparent' : 'background.paper',
    borderRadius: 1
  };
  
  // Additional styles for fullScreen mode
  const fullScreenStyles = fullScreen ? {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: theme.zIndex.modal,
    backgroundColor: transparent ? 'rgba(255, 255, 255, 0.7)' : 'background.paper'
  } : {};
  
  return (
    <Box sx={{ ...containerStyles, ...fullScreenStyles } as any}>
      <CircularProgress size={progressSize} color="primary" />
      
      {message && (
        <Typography variant={textVariant} color="text.secondary">
          {message}
        </Typography>
      )}
    </Box>
  );
};