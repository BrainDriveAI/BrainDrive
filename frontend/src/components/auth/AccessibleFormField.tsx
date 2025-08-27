import React from 'react';
import {
  TextField,
  TextFieldProps,
  Box,
  Typography,
  useTheme
} from '@mui/material';

interface AccessibleFormFieldProps extends Omit<TextFieldProps, 'error' | 'helperText'> {
  error?: boolean;
  errorMessage?: string;
  helpText?: string;
  fieldId: string;
  ariaDescribedBy?: string;
  validationStatus?: 'valid' | 'invalid' | 'pending';
}

const AccessibleFormField: React.FC<AccessibleFormFieldProps> = ({
  error,
  errorMessage,
  helpText,
  fieldId,
  ariaDescribedBy,
  validationStatus,
  ...textFieldProps
}) => {
  const theme = useTheme();
  
  // Generate unique IDs for accessibility
  const errorId = `${fieldId}-error`;
  const helpId = `${fieldId}-help`;
  
  // Build aria-describedby attribute
  const describedByIds = [
    helpText ? helpId : null,
    error && errorMessage ? errorId : null,
    ariaDescribedBy
  ].filter(Boolean).join(' ');

  // Determine ARIA attributes based on validation status
  const getAriaAttributes = () => {
    const baseAttributes = {
      'aria-describedby': describedByIds || undefined,
      'aria-invalid': error ? true : false,
    };

    if (validationStatus === 'pending') {
      return {
        ...baseAttributes,
        'aria-busy': true,
        'aria-live': 'polite' as const
      };
    }

    return baseAttributes;
  };

  return (
    <Box>
      <TextField
        {...textFieldProps}
        id={fieldId}
        error={error}
        helperText=" " // Reserve space for consistent layout
        inputProps={{
          ...textFieldProps.inputProps,
          ...getAriaAttributes()
        }}
        sx={{
          ...textFieldProps.sx,
          '& .MuiFormHelperText-root': {
            // Hide the default helper text since we're using custom ones
            visibility: 'hidden',
            height: '1px',
            margin: 0
          }
        }}
      />
      
      {/* Custom help text with proper ARIA attributes */}
      {helpText && !error && (
        <Typography
          id={helpId}
          variant="caption"
          sx={{
            display: 'block',
            mt: 0.5,
            px: 1.75,
            color: 'text.secondary',
            fontSize: '0.75rem'
          }}
          role="status"
          aria-live="polite"
        >
          {helpText}
        </Typography>
      )}
      
      {/* Custom error message with proper ARIA attributes */}
      {error && errorMessage && (
        <Typography
          id={errorId}
          variant="caption"
          sx={{
            display: 'block',
            mt: 0.5,
            px: 1.75,
            color: 'error.main',
            fontSize: '0.75rem'
          }}
          role="alert"
          aria-live="assertive"
        >
          {errorMessage}
        </Typography>
      )}
      
      {/* Validation status indicator for screen readers */}
      {validationStatus && (
        <Box
          component="span"
          sx={{
            position: 'absolute',
            left: '-10000px',
            width: '1px',
            height: '1px',
            overflow: 'hidden'
          }}
          aria-live="polite"
          role="status"
        >
          {validationStatus === 'valid' && 'Field is valid'}
          {validationStatus === 'invalid' && 'Field has errors'}
          {validationStatus === 'pending' && 'Validating field'}
        </Box>
      )}
    </Box>
  );
};

export default AccessibleFormField;