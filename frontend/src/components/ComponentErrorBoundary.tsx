import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Box, Button, Typography, Paper } from '@mui/material';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

class ComponentErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('Component Error:', error);
    console.error('Component Stack:', errorInfo.componentStack);
    
    this.setState({
      error,
      errorInfo
    });
  }

  handleReset = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null
    });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <Box
          sx={{
            width: '100%',
            height: '100%',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            p: 2
          }}
        >
          <Paper
            elevation={3}
            sx={{
              p: 3,
              maxWidth: '100%',
              width: '100%',
              textAlign: 'center'
            }}
          >
            <ErrorOutlineIcon sx={{ fontSize: 40, color: 'error.main', mb: 1 }} />
            <Typography variant="h5" component="h2" gutterBottom color="error">
              Component Error
            </Typography>
            <Typography variant="body1" gutterBottom color="text.secondary">
              {this.state.error?.message || 'An unexpected error occurred'}
            </Typography>
            {this.state.errorInfo && (
              <Typography
                variant="body2"
                sx={{
                  mt: 2,
                  p: 2,
                  bgcolor: 'grey.100',
                  borderRadius: 1,
                  fontFamily: 'monospace',
                  textAlign: 'left',
                  overflowX: 'auto',
                  maxHeight: '200px',
                  overflowY: 'auto'
                }}
              >
                {this.state.errorInfo.componentStack}
              </Typography>
            )}
            <Box sx={{ mt: 3 }}>
              <Button
                variant="contained"
                onClick={this.handleReset}
              >
                Try Again
              </Button>
            </Box>
          </Paper>
        </Box>
      );
    }

    return this.props.children;
  }
}

export default ComponentErrorBoundary;
