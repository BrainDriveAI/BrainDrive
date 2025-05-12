import React from 'react';
import { Box, Typography, Paper } from '@mui/material';

const SimpleSettings = () => {
  console.log('SimpleSettings component rendered');
  
  return (
    <Box sx={{ width: '100%', p: 2 }}>
      <Typography variant="h4" gutterBottom>
        Simple Settings
      </Typography>
      
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h5" gutterBottom>
          This is a simple test component
        </Typography>
        <Typography variant="body1">
          If you can see this, the Settings component is rendering correctly.
        </Typography>
      </Paper>
    </Box>
  );
};

export default SimpleSettings;
