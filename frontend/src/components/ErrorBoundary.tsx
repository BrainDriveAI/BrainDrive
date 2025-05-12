import React from 'react';
import { Box, Button, Typography, Paper } from '@mui/material';
import { useRouteError, isRouteErrorResponse, useNavigate } from 'react-router-dom';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';

export default function ErrorBoundary() {
  const error = useRouteError();
  const navigate = useNavigate();

  let errorMessage = 'An unexpected error occurred';
  let errorDetails = '';

  if (isRouteErrorResponse(error)) {
    errorMessage = error.statusText;
    errorDetails = error.data?.message || '';
  } else if (error instanceof Error) {
    errorMessage = error.message;
    errorDetails = error.stack || '';
  }

  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        bgcolor: 'background.default'
      }}
    >
      <Paper
        elevation={3}
        sx={{
          p: 4,
          maxWidth: 600,
          width: '90%',
          textAlign: 'center'
        }}
      >
        <ErrorOutlineIcon sx={{ fontSize: 60, color: 'error.main', mb: 2 }} />
        <Typography variant="h4" component="h1" gutterBottom color="error">
          Oops! Something went wrong
        </Typography>
        <Typography variant="h6" gutterBottom color="text.secondary">
          {errorMessage}
        </Typography>
        {errorDetails && (
          <Typography
            variant="body2"
            sx={{
              mt: 2,
              p: 2,
              bgcolor: 'grey.100',
              borderRadius: 1,
              fontFamily: 'monospace',
              textAlign: 'left',
              overflowX: 'auto'
            }}
          >
            {errorDetails}
          </Typography>
        )}
        <Box sx={{ mt: 4, display: 'flex', gap: 2, justifyContent: 'center' }}>
          <Button
            variant="contained"
            onClick={() => navigate('/')}
          >
            Go to Dashboard
          </Button>
          <Button
            variant="outlined"
            onClick={() => window.location.reload()}
          >
            Refresh Page
          </Button>
        </Box>
      </Paper>
    </Box>
  );
}
