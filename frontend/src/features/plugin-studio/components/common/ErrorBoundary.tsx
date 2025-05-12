import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Box, Typography, Button, Paper } from '@mui/material';
import ErrorIcon from '@mui/icons-material/Error';
import RefreshIcon from '@mui/icons-material/Refresh';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * Component that catches JavaScript errors anywhere in its child component tree,
 * logs those errors, and displays a fallback UI instead of the component tree that crashed.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null
    };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    // Update state so the next render will show the fallback UI
    return {
      hasError: true,
      error,
      errorInfo: null
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log the error to the console
    console.error('Error caught by ErrorBoundary:', error, errorInfo);
    
    // Update state with error details
    this.setState({
      error,
      errorInfo
    });
    
    // Call the onError callback if provided
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }
  }

  handleReset = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null
    });
  }

  render(): ReactNode {
    if (this.state.hasError) {
      // If a custom fallback is provided, use it
      if (this.props.fallback) {
        return this.props.fallback;
      }
      
      // Otherwise, use the default fallback UI
      return (
        <Paper 
          elevation={3}
          sx={{
            p: 3,
            m: 2,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 2,
            backgroundColor: 'error.light',
            color: 'error.contrastText'
          }}
        >
          <ErrorIcon color="error" sx={{ fontSize: 48 }} />
          
          <Typography variant="h5" component="h2" gutterBottom>
            Something went wrong
          </Typography>
          
          <Typography variant="body1" align="center" gutterBottom>
            {this.state.error?.message || 'An unexpected error occurred'}
          </Typography>
          
          {this.state.errorInfo && (
            <Box 
              sx={{ 
                mt: 2, 
                p: 2, 
                bgcolor: 'background.paper',
                color: 'text.primary',
                borderRadius: 1,
                width: '100%',
                overflow: 'auto',
                maxHeight: '200px'
              }}
            >
              <Typography variant="caption" component="pre" sx={{ whiteSpace: 'pre-wrap' }}>
                {this.state.errorInfo.componentStack}
              </Typography>
            </Box>
          )}
          
          <Button 
            variant="contained" 
            color="primary" 
            onClick={this.handleReset}
            startIcon={<RefreshIcon />}
            sx={{ mt: 2 }}
          >
            Try Again
          </Button>
        </Paper>
      );
    }

    // If there's no error, render the children
    return this.props.children;
  }
}