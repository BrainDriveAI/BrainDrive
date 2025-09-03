import React from 'react';
import {
  Box,
  LinearProgress,
  Typography,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Chip
} from '@mui/material';
import {
  Check as CheckIcon,
  Close as CloseIcon
} from '@mui/icons-material';
import { validatePassword } from '../../utils/authErrorHandler';

interface PasswordStrengthIndicatorProps {
  password: string;
  showDetails?: boolean;
  compact?: boolean;
}

const PasswordStrengthIndicator: React.FC<PasswordStrengthIndicatorProps> = ({
  password,
  showDetails = true,
  compact = false
}) => {
  const validation = validatePassword(password);
  
  const getStrengthColor = (strength: string) => {
    switch (strength) {
      case 'strong': return 'success';
      case 'medium': return 'warning';
      default: return 'error';
    }
  };

  const getStrengthValue = (strength: string) => {
    switch (strength) {
      case 'strong': return 100;
      case 'medium': return 60;
      default: return 30;
    }
  };

  const criteria = [
    { 
      label: 'At least 8 characters', 
      met: password.length >= 8 
    },
    { 
      label: 'Contains lowercase letter', 
      met: /[a-z]/.test(password) 
    },
    { 
      label: 'Contains uppercase letter', 
      met: /[A-Z]/.test(password) 
    },
    { 
      label: 'Contains number', 
      met: /\d/.test(password) 
    },
    { 
      label: 'Contains special character', 
      met: /[!@#$%^&*(),.?":{}|<>]/.test(password) 
    }
  ];

  if (!password) return null;

  if (compact) {
    return (
      <Box sx={{ mt: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
          <Typography variant="caption" sx={{ mr: 1 }}>
            Password strength:
          </Typography>
          <Chip 
            label={validation.strength.toUpperCase()} 
            size="small"
            color={getStrengthColor(validation.strength) as any}
            variant="outlined"
            sx={{ fontSize: '0.7rem', height: '20px' }}
          />
        </Box>
        <LinearProgress
          variant="determinate"
          value={getStrengthValue(validation.strength)}
          color={getStrengthColor(validation.strength) as any}
          sx={{ height: 4, borderRadius: 2 }}
        />
      </Box>
    );
  }

  return (
    <Box sx={{ mt: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
        <Typography variant="caption" sx={{ mr: 1 }}>
          Password strength:
        </Typography>
        <Chip 
          label={validation.strength.toUpperCase()} 
          size="small"
          color={getStrengthColor(validation.strength) as any}
          variant="outlined"
          sx={{ fontSize: '0.7rem', height: '20px' }}
        />
      </Box>
      
      <LinearProgress
        variant="determinate"
        value={getStrengthValue(validation.strength)}
        color={getStrengthColor(validation.strength) as any}
        sx={{ height: 6, borderRadius: 3, mb: showDetails ? 1 : 0 }}
      />

      {showDetails && (
        <List dense sx={{ py: 0 }}>
          {criteria.map((criterion, index) => (
            <ListItem key={index} sx={{ py: 0.25, pl: 0 }}>
              <ListItemIcon sx={{ minWidth: 24 }}>
                {criterion.met ? (
                  <CheckIcon sx={{ fontSize: 16, color: 'success.main' }} />
                ) : (
                  <CloseIcon sx={{ fontSize: 16, color: 'error.main' }} />
                )}
              </ListItemIcon>
              <ListItemText 
                primary={criterion.label}
                primaryTypographyProps={{
                  variant: 'caption',
                  sx: { 
                    fontSize: '0.75rem',
                    color: criterion.met ? 'success.main' : 'text.secondary'
                  }
                }}
              />
            </ListItem>
          ))}
        </List>
      )}
    </Box>
  );
};

export default PasswordStrengthIndicator;