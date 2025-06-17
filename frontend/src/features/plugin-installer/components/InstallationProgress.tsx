import React from 'react';
import {
  Box,
  Paper,
  Typography,
  Stepper,
  Step,
  StepLabel,
  StepContent,
  CircularProgress,
  Alert,
  Chip
} from '@mui/material';
import {
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Schedule as ScheduleIcon
} from '@mui/icons-material';
import { InstallationStep } from '../types';

interface InstallationProgressProps {
  steps: InstallationStep[];
  currentStep: number;
  isInstalling: boolean;
  errorDetails?: any;
  suggestions?: string[];
}

const InstallationProgress: React.FC<InstallationProgressProps> = ({
  steps,
  currentStep,
  isInstalling,
  errorDetails,
  suggestions
}) => {
  const getStepIcon = (step: InstallationStep, stepIndex: number) => {
    switch (step.status) {
      case 'completed':
        return <CheckCircleIcon color="success" />;
      case 'error':
        return <ErrorIcon color="error" />;
      case 'in-progress':
        return <CircularProgress size={24} />;
      case 'pending':
      default:
        return <ScheduleIcon color="disabled" />;
    }
  };

  const getStepColor = (step: InstallationStep): 'success' | 'error' | 'primary' | 'default' => {
    switch (step.status) {
      case 'completed':
        return 'success';
      case 'error':
        return 'error';
      case 'in-progress':
        return 'primary';
      case 'pending':
      default:
        return 'default';
    }
  };

  if (!isInstalling && steps.every(step => step.status === 'pending')) {
    return null;
  }

  return (
    <Paper sx={{ p: 3, mb: 3 }}>
      <Box sx={{ mb: 2 }}>
        <Typography variant="h6" gutterBottom>
          Installation Progress
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <Chip
            label={isInstalling ? 'Installing...' : 'Installation Complete'}
            color={isInstalling ? 'primary' : 'success'}
            variant={isInstalling ? 'outlined' : 'filled'}
          />
          {isInstalling && (
            <CircularProgress size={16} />
          )}
        </Box>
      </Box>

      <Stepper activeStep={currentStep} orientation="vertical">
        {steps.map((step, index) => (
          <Step key={step.id} completed={step.status === 'completed'}>
            <StepLabel
              error={step.status === 'error'}
              icon={getStepIcon(step, index)}
              sx={{
                '& .MuiStepLabel-label': {
                  color: step.status === 'error' ? 'error.main' : 'inherit'
                }
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="body1">
                  {step.label}
                </Typography>
                <Chip
                  size="small"
                  label={step.status}
                  color={getStepColor(step)}
                  variant="outlined"
                />
              </Box>
            </StepLabel>
            <StepContent>
              {step.message && (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  {step.message}
                </Typography>
              )}
              {step.error && (
                <Alert severity="error" sx={{ mt: 1 }}>
                  {step.error}
                </Alert>
              )}
            </StepContent>
          </Step>
        ))}
      </Stepper>

      {/* Show overall error if installation failed */}
      {!isInstalling && steps.some(step => step.status === 'error') && (
        <Alert severity="error" sx={{ mt: 2 }}>
          <Typography variant="body2" sx={{ fontWeight: 'medium' }}>
            Installation Failed
          </Typography>
          <Typography variant="body2" sx={{ mb: 2 }}>
            The plugin installation encountered an error. Please check the details above and try again.
          </Typography>

          {/* Show detailed error information if available */}
          {errorDetails && (
            <Box sx={{ mt: 2, p: 2, bgcolor: 'rgba(0,0,0,0.1)', borderRadius: 1 }}>
              <Typography variant="body2" sx={{ fontWeight: 'medium', mb: 1 }}>
                Error Details:
              </Typography>
              <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.875rem', mb: 1 }}>
                Step: {errorDetails.step}
              </Typography>
              {errorDetails.plugin_slug && (
                <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.875rem', mb: 1 }}>
                  Plugin: {errorDetails.plugin_slug}
                </Typography>
              )}
              {errorDetails.exception_type && (
                <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.875rem', mb: 1 }}>
                  Error Type: {errorDetails.exception_type}
                </Typography>
              )}
            </Box>
          )}

          {/* Show suggestions if available */}
          {suggestions && suggestions.length > 0 && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="body2" sx={{ fontWeight: 'medium', mb: 1 }}>
                Suggestions to fix this issue:
              </Typography>
              <Box component="ul" sx={{ m: 0, pl: 2 }}>
                {suggestions.map((suggestion, index) => (
                  <li key={index}>
                    <Typography variant="body2" sx={{ fontSize: '0.875rem' }}>
                      {suggestion}
                    </Typography>
                  </li>
                ))}
              </Box>
            </Box>
          )}
        </Alert>
      )}

      {/* Show success message if all steps completed */}
      {!isInstalling && steps.every(step => step.status === 'completed') && (
        <Alert severity="success" sx={{ mt: 2 }}>
          <Typography variant="body2" sx={{ fontWeight: 'medium' }}>
            Installation Successful!
          </Typography>
          <Typography variant="body2">
            The plugin has been installed and is now available in your plugin manager.
          </Typography>
        </Alert>
      )}
    </Paper>
  );
};

export default InstallationProgress;