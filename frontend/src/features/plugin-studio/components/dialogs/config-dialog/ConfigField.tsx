import React from 'react';
import {
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  FormHelperText,
  Switch,
  FormControlLabel,
  Typography,
  Box,
  Button,
  Tooltip
} from '@mui/material';
import DevicesIcon from '@mui/icons-material/Devices';

interface ConfigFieldProps {
  field: any;
  fieldName: string;
  value: any;
  error?: string;
  isLayoutSpecific: boolean;
  currentDeviceType: string;
  handleConfigChange: (fieldName: string, value: any, event?: React.ChangeEvent<HTMLInputElement>) => void;
  handleConfigModeToggle: (fieldName: string) => void;
  handleInputFocus: (fieldName: string) => void;
  inputRefs: React.MutableRefObject<Record<string, HTMLInputElement | null>>;
}

/**
 * Component for rendering a configuration field
 */
export const ConfigField = ({
  field,
  fieldName,
  value,
  error,
  isLayoutSpecific,
  currentDeviceType,
  handleConfigChange,
  handleConfigModeToggle,
  handleInputFocus,
  inputRefs
}) => {
  const textColor = error ? 'error.main' : 'text.primary';
  
  // Wrapper component for all fields to add the layout toggle
  const FieldWrapper = ({ children }: { children: React.ReactNode }) => (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, width: '100%' }}>
      {children}
      
      {/* Layout toggle button */}
      <Tooltip title={isLayoutSpecific ? `This setting applies only to ${currentDeviceType} layout` : 'This setting applies to all layouts'}>
        <Button
          variant="outlined"
          size="small"
          color={isLayoutSpecific ? 'primary' : 'inherit'}
          onClick={() => handleConfigModeToggle(fieldName)}
          sx={{
            minWidth: 'auto',
            p: 0.5,
            borderRadius: 1,
            mt: 1
          }}
        >
          <DevicesIcon fontSize="small" />
        </Button>
      </Tooltip>
    </Box>
  );
  
  switch (field.type) {
    case 'string':
      return (
        <FieldWrapper>
          <TextField
            fullWidth
            label={field.label || field.name}
            value={value || ''}
            onChange={(e) => handleConfigChange(fieldName, e.target.value, e)}
            error={!!error}
            helperText={error || field.description}
            margin="normal"
            size="small"
            inputRef={(el) => {
              inputRefs.current[fieldName] = el;
            }}
            onFocus={() => handleInputFocus(fieldName)}
            InputLabelProps={{ shrink: true }}
          />
        </FieldWrapper>
      );
    
    case 'number':
      return (
        <FieldWrapper>
          <TextField
            fullWidth
            label={field.label || field.name}
            value={value === undefined ? '' : value}
            onChange={(e) => {
              const numValue = e.target.value === '' ? '' : Number(e.target.value);
              handleConfigChange(fieldName, numValue, e);
            }}
            error={!!error}
            helperText={error || field.description}
            margin="normal"
            size="small"
            type="number"
            inputRef={(el) => {
              inputRefs.current[fieldName] = el;
            }}
            onFocus={() => handleInputFocus(fieldName)}
            InputLabelProps={{ shrink: true }}
            inputProps={{
              min: field.min,
              max: field.max,
              step: field.step || 1
            }}
          />
        </FieldWrapper>
      );
    
    case 'boolean':
      return (
        <FieldWrapper>
          <FormControlLabel
            control={
              <Switch
                checked={!!value}
                onChange={(e) => handleConfigChange(fieldName, e.target.checked)}
                color="primary"
              />
            }
            label={
              <Typography sx={{ color: textColor }}>
                {field.label || field.name}
                {field.description && (
                  <Typography variant="caption" display="block" color="text.secondary">
                    {field.description}
                  </Typography>
                )}
              </Typography>
            }
          />
        </FieldWrapper>
      );
    
    case 'select':
      return (
        <FieldWrapper>
          <FormControl
            fullWidth
            error={!!error}
            margin="normal"
            size="small"
          >
            <InputLabel shrink>{field.label || field.name}</InputLabel>
            <Select
              value={value || ''}
              onChange={(e) => {
                handleConfigChange(fieldName, e.target.value);
              }}
              displayEmpty
              label={field.label || field.name}
              inputRef={(el) => {
                inputRefs.current[fieldName] = el;
              }}
            >
              {field.options?.map((option: any) => (
                <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
              ))}
              {field.enum?.map((option: string) => (
                <MenuItem key={option} value={option}>{option}</MenuItem>
              ))}
            </Select>
            {(error || field.description) && (
              <FormHelperText>{error || field.description}</FormHelperText>
            )}
          </FormControl>
        </FieldWrapper>
      );
      
    case 'array':
      return (
        <FieldWrapper>
          <TextField
            fullWidth
            label={field.label || field.name}
            value={Array.isArray(value) ? value.join(', ') : value || ''}
            onChange={(e) => {
              // Convert comma-separated string to array
              const arrayValue = e.target.value
                .split(',')
                .map(item => item.trim())
                .filter(item => item !== '');
              
              handleConfigChange(fieldName, arrayValue, e);
            }}
            error={!!error}
            helperText={error || field.description || 'Enter comma-separated values'}
            margin="normal"
            size="small"
            inputRef={(el) => {
              inputRefs.current[fieldName] = el;
            }}
            onFocus={() => handleInputFocus(fieldName)}
            InputLabelProps={{ shrink: true }}
          />
        </FieldWrapper>
      );
      
    default:
      // Handle arrays that don't have type 'array' explicitly set
      if (Array.isArray(value)) {
        return (
          <FieldWrapper>
            <TextField
              fullWidth
              label={field.label || field.name}
              value={value.join(', ')}
              onChange={(e) => {
                // Convert comma-separated string to array
                const arrayValue = e.target.value
                  .split(',')
                  .map(item => item.trim())
                  .filter(item => item !== '');
                
                handleConfigChange(fieldName, arrayValue, e);
              }}
              error={!!error}
              helperText={error || field.description || 'Enter comma-separated values'}
              margin="normal"
              size="small"
              inputRef={(el) => {
                inputRefs.current[fieldName] = el;
              }}
              onFocus={() => handleInputFocus(fieldName)}
              InputLabelProps={{ shrink: true }}
            />
          </FieldWrapper>
        );
      } else {
        // Default to string input for unknown types
        return (
          <FieldWrapper>
            <TextField
              fullWidth
              label={field.label || field.name}
              value={value || ''}
              onChange={(e) => handleConfigChange(fieldName, e.target.value, e)}
              error={!!error}
              helperText={error || field.description}
              margin="normal"
              size="small"
              inputRef={(el) => {
                inputRefs.current[fieldName] = el;
              }}
              onFocus={() => handleInputFocus(fieldName)}
              InputLabelProps={{ shrink: true }}
            />
          </FieldWrapper>
        );
      }
  }
};