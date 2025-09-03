import React, { useState, useEffect } from 'react';
import {
  Alert,
  AlertTitle,
  Box,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Button,
  Chip,
  Typography,
  Collapse
} from '@mui/material';
import {
  Error as ErrorIcon,
  Warning as WarningIcon,
  Info as InfoIcon,
  LightbulbOutlined as SuggestionIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon
} from '@mui/icons-material';
import { AuthError } from '../../utils/authErrorHandler';

interface EnhancedErrorDisplayProps {
  error: AuthError | null;
  onAction?: () => void;
  actionLabel?: string;
  showSuggestions?: boolean;
  compact?: boolean;
}

const EnhancedErrorDisplay: React.FC<EnhancedErrorDisplayProps> = ({
  error,
  onAction,
  actionLabel,
  showSuggestions = true,
  compact = false
}) => {
  const [showDetails, setShowDetails] = useState(false);
  const [persistentError, setPersistentError] = useState<AuthError | null>(null);

  // Keep error visible for a minimum time to prevent flickering
  useEffect(() => {
    if (error) {
      setPersistentError(error);
      setShowDetails(false); // Reset details when new error appears
    } else if (persistentError) {
      // Keep the error visible for a short time even after it's cleared
      const timer = setTimeout(() => {
        setPersistentError(null);
      }, 500); // 500ms delay before clearing
      
      return () => clearTimeout(timer);
    }
  }, [error, persistentError]);

  const displayError = error || persistentError;
  
  if (!displayError) return null;

  const getSeverity = (code: string): 'error' | 'warning' | 'info' => {
    if (code.includes('NETWORK') || code.includes('SERVER')) return 'error';
    if (code.includes('VALIDATION') || code.includes('INVALID')) return 'warning';
    return 'info';
  };

  const getIcon = (severity: string) => {
    switch (severity) {
      case 'error': return <ErrorIcon />;
      case 'warning': return <WarningIcon />;
      default: return <InfoIcon />;
    }
  };

  const severity = getSeverity(displayError.code);

  if (compact) {
    return (
      <Alert 
        severity={severity} 
        sx={{ mt: 1, mb: 1 }}
        action={
          displayError.actionable && onAction && actionLabel ? (
            <Button color="inherit" size="small" onClick={onAction}>
              {actionLabel}
            </Button>
          ) : undefined
        }
      >
        {displayError.message}
      </Alert>
    );
  }

  return (
    <Box sx={{ mt: 2, mb: 2 }}>
      <Alert
        severity={severity}
        icon={getIcon(severity)}
        sx={{
          borderRadius: 2,
          '& .MuiAlert-message': {
            width: '100%'
          },
          '& .MuiAlert-icon': {
            fontSize: '1.2rem'
          }
        }}
      >
        <Typography
          variant="body2"
          sx={{
            mb: showSuggestions && displayError.suggestions?.length ? 1.5 : 0,
            fontWeight: 500,
            lineHeight: 1.4
          }}
        >
          {displayError.message}
        </Typography>

        {showSuggestions && displayError.suggestions && displayError.suggestions.length > 0 && (
          <>
            <Button
              size="small"
              startIcon={showDetails ? <ExpandLessIcon /> : <ExpandMoreIcon />}
              onClick={() => setShowDetails(!showDetails)}
              sx={{
                minWidth: 'auto',
                p: 0,
                fontSize: '0.8rem',
                textTransform: 'none',
                color: 'text.secondary',
                '&:hover': {
                  backgroundColor: 'transparent',
                  color: 'primary.main'
                }
              }}
            >
              {showDetails ? 'Hide help' : 'Need help?'}
            </Button>
            
            <Collapse in={showDetails}>
              <Box sx={{ mt: 1.5, p: 1.5, bgcolor: 'action.hover', borderRadius: 1 }}>
                <Typography
                  variant="caption"
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    mb: 1,
                    fontWeight: 600,
                    color: 'text.primary'
                  }}
                >
                  <SuggestionIcon sx={{ fontSize: 16, mr: 0.5, color: 'primary.main' }} />
                  Here's what you can try:
                </Typography>
                <Box sx={{ ml: 2 }}>
                  {displayError.suggestions!.map((suggestion, index) => (
                    <Box
                      key={index}
                      sx={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        mb: index < displayError.suggestions!.length - 1 ? 1 : 0
                      }}
                    >
                      <Box
                        sx={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          bgcolor: 'primary.main',
                          mt: 0.5,
                          mr: 1,
                          flexShrink: 0
                        }}
                      />
                      <Typography
                        variant="body2"
                        sx={{
                          fontSize: '0.85rem',
                          lineHeight: 1.4,
                          color: 'text.primary'
                        }}
                      >
                        {suggestion}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              </Box>
            </Collapse>
          </>
        )}

        {displayError.actionable && onAction && actionLabel && (
          <Box sx={{ mt: 2 }}>
            <Button
              variant="contained"
              size="small"
              onClick={onAction}
              sx={{
                textTransform: 'none',
                borderRadius: 1.5,
                px: 2
              }}
            >
              {actionLabel}
            </Button>
          </Box>
        )}
      </Alert>
    </Box>
  );
};

export default EnhancedErrorDisplay;