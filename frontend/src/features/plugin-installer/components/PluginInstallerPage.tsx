import React, { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Container,
  Typography,
  Box,
  Button,
  Breadcrumbs,
  Link,
  Alert
} from '@mui/material';
import {
  ArrowBack as ArrowBackIcon,
  Extension as ExtensionIcon,
  Add as AddIcon
} from '@mui/icons-material';
import InstallMethodTabs from './install-methods/InstallMethodTabs';
import InstallationProgress from './InstallationProgress';
import InstallationResult from './InstallationResult';
import { usePluginInstaller } from '../hooks';
import { PluginInstallRequest } from '../types';

const PluginInstallerPage: React.FC = () => {
  const navigate = useNavigate();
  const {
    installationState,
    installPlugin,
    resetInstallation,
    validateUrl,
    normalizeUrl
  } = usePluginInstaller();

  const handleGoBack = useCallback(() => {
    navigate('/plugin-manager');
  }, [navigate]);

  const handleInstallAnother = useCallback(() => {
    resetInstallation('github');
  }, [resetInstallation]);

  const handleGoToPluginManager = useCallback(() => {
    navigate('/plugin-manager');
  }, [navigate]);

  const handleInstall = useCallback(async (request: PluginInstallRequest) => {
    await installPlugin(request);
  }, [installPlugin]);

  const showForm = !installationState.result;
  const showProgress = installationState.isInstalling || installationState.steps.some(step => step.status !== 'pending');
  const showResult = installationState.result && !installationState.isInstalling;

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      {/* Header */}
      <Box sx={{ mb: 4 }}>
        <Breadcrumbs sx={{ mb: 2 }}>
          <Link
            component="button"
            variant="body2"
            onClick={handleGoBack}
            sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}
          >
            <ExtensionIcon fontSize="small" />
            Plugin Manager
          </Link>
          <Typography variant="body2" color="text.primary">
            Install Plugin
          </Typography>
        </Breadcrumbs>

        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Typography variant="h4" component="h1">
            Install New Plugin
          </Typography>
          <Button
            variant="outlined"
            startIcon={<ArrowBackIcon />}
            onClick={handleGoBack}
            disabled={installationState.isInstalling}
          >
            Back to Plugin Manager
          </Button>
        </Box>

        <Typography variant="body1" color="text.secondary">
          Install plugins from GitHub repositories or upload local archive files. Plugins will be downloaded, validated, and installed for your account only.
        </Typography>
      </Box>

      {/* Information Alert */}
      <Alert severity="info" sx={{ mb: 3 }}>
        <Typography variant="body2" sx={{ fontWeight: 'medium', mb: 1 }}>
          How Plugin Installation Works:
        </Typography>
        <Box component="ul" sx={{ m: 0, pl: 2 }}>
          <li>Choose your installation method: GitHub repository or local file upload</li>
          <li>For GitHub: Enter repository URL and select version</li>
          <li>For local files: Upload ZIP, RAR, or TAR.GZ archive containing the plugin</li>
          <li>Plugin files are validated and installed securely for your account</li>
          <li>Only you will have access to the installed plugin</li>
          <li>You can uninstall or update the plugin at any time</li>
        </Box>
      </Alert>

      {/* Installation Form */}
      {showForm && (
        <InstallMethodTabs
          onInstall={handleInstall}
          isInstalling={installationState.isInstalling}
          onValidateUrl={validateUrl}
        />
      )}

      {/* Installation Progress */}
      {showProgress && (
        <InstallationProgress
          steps={installationState.steps}
          currentStep={installationState.currentStep}
          isInstalling={installationState.isInstalling}
          errorDetails={installationState.errorDetails}
          suggestions={installationState.suggestions}
        />
      )}

      {/* Installation Result */}
      {showResult && installationState.result && (
        <InstallationResult
          result={installationState.result}
          onInstallAnother={handleInstallAnother}
          onGoToPluginManager={handleGoToPluginManager}
        />
      )}

      {/* Error Display */}
      {installationState.error && !installationState.result && (
        <Alert severity="error" sx={{ mb: 3 }}>
          <Typography variant="body2" sx={{ fontWeight: 'medium' }}>
            Installation Error
          </Typography>
          <Typography variant="body2" sx={{ mb: 2, whiteSpace: 'pre-line' }}>
            {installationState.error}
          </Typography>

          {/* Show suggestions if available */}
          {installationState.suggestions && installationState.suggestions.length > 0 && (
            <Box sx={{ mt: 2, mb: 2 }}>
              <Typography variant="body2" sx={{ fontWeight: 'medium', mb: 1 }}>
                Suggestions to fix this issue:
              </Typography>
              <Box component="ul" sx={{ m: 0, pl: 2 }}>
                {installationState.suggestions.map((suggestion, index) => (
                  <li key={index}>
                    <Typography variant="body2" sx={{ fontSize: '0.875rem' }}>
                      {suggestion}
                    </Typography>
                  </li>
                ))}
              </Box>
            </Box>
          )}

          <Box sx={{ mt: 2 }}>
            <Button
              variant="outlined"
              size="small"
              startIcon={<AddIcon />}
              onClick={() => resetInstallation('github')}
            >
              Try Again
            </Button>
          </Box>
        </Alert>
      )}

      {/* Help Section */}
      <Box sx={{ mt: 4, p: 3, bgcolor: 'background.paper', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
        <Typography variant="h6" gutterBottom>
          Need Help?
        </Typography>
        <Typography variant="body2" color="text.secondary" paragraph>
          If you're having trouble installing a plugin, make sure:
        </Typography>
        <Box component="ul" sx={{ m: 0, pl: 2, color: 'text.secondary' }}>
          <li>For GitHub: The repository URL is correct and accessible</li>
          <li>For GitHub: The repository contains a valid BrainDrive plugin with releases</li>
          <li>For local files: The archive contains a valid plugin structure with plugin.json</li>
          <li>For local files: The file format is supported (ZIP, RAR, TAR.GZ)</li>
          <li>You have a stable internet connection</li>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          For plugin development guidelines, check the BrainDrive documentation.
        </Typography>
      </Box>
    </Container>
  );
};

export default PluginInstallerPage;