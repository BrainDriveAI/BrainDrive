import React, { useState, useCallback } from 'react';
import {
  Box,
  Tabs,
  Tab,
  Typography,
  Paper
} from '@mui/material';
import {
  GitHub as GitHubIcon,
  InsertDriveFile as FileIcon,
  Store as StoreIcon
} from '@mui/icons-material';
import GitHubInstallForm from './GitHubInstallForm';
import LocalFileInstallForm from './LocalFileInstallForm';
import { PluginInstallRequest, InstallationMethod, InstallationMethodConfig } from '../../types';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

const TabPanel: React.FC<TabPanelProps> = ({ children, value, index, ...other }) => {
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`install-method-tabpanel-${index}`}
      aria-labelledby={`install-method-tab-${index}`}
      {...other}
    >
      {value === index && (
        <Box sx={{ pt: 3 }}>
          {children}
        </Box>
      )}
    </div>
  );
};

const a11yProps = (index: number) => {
  return {
    id: `install-method-tab-${index}`,
    'aria-controls': `install-method-tabpanel-${index}`,
  };
};

interface InstallMethodTabsProps {
  onInstall: (request: PluginInstallRequest) => void;
  isInstalling: boolean;
  onValidateUrl?: (url: string) => { isValid: boolean; error?: string };
  defaultMethod?: InstallationMethod;
}

const InstallMethodTabs: React.FC<InstallMethodTabsProps> = ({
  onInstall,
  isInstalling,
  onValidateUrl,
  defaultMethod = 'github'
}) => {
  // Define available installation methods
  const installationMethods: InstallationMethodConfig[] = [
    {
      id: 'github',
      label: 'GitHub Repository',
      description: 'Install from GitHub repository URL',
      icon: GitHubIcon
    },
    {
      id: 'local-file',
      label: 'Local File',
      description: 'Upload plugin archive from your computer',
      icon: FileIcon
    },
    // Future enhancement: Plugin marketplace
    // {
    //   id: 'marketplace',
    //   label: 'Marketplace',
    //   description: 'Browse and install from plugin marketplace',
    //   icon: StoreIcon,
    //   disabled: true
    // }
  ];

  // Find the default tab index
  const defaultTabIndex = installationMethods.findIndex(method => method.id === defaultMethod);
  const [selectedTab, setSelectedTab] = useState(defaultTabIndex >= 0 ? defaultTabIndex : 0);

  const handleTabChange = useCallback((event: React.SyntheticEvent, newValue: number) => {
    if (!isInstalling) {
      setSelectedTab(newValue);
    }
  }, [isInstalling]);

  const currentMethod = installationMethods[selectedTab];

  return (
    <Box sx={{ width: '100%' }}>
      {/* Tab Header */}
      <Paper sx={{ mb: 3 }}>
        <Box sx={{ p: 3, pb: 0 }}>
          <Typography variant="h6" gutterBottom>
            Choose Installation Method
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Select how you want to install your plugin. Each method supports the same plugin format.
          </Typography>
        </Box>

        <Tabs
          value={selectedTab}
          onChange={handleTabChange}
          aria-label="plugin installation methods"
          variant="fullWidth"
          sx={{
            borderBottom: 1,
            borderColor: 'divider',
            '& .MuiTab-root': {
              minHeight: 72,
              textTransform: 'none',
              opacity: isInstalling ? 0.5 : 1,
              pointerEvents: isInstalling ? 'none' : 'auto'
            }
          }}
        >
          {installationMethods.map((method, index) => {
            const IconComponent = method.icon;
            return (
              <Tab
                key={method.id}
                icon={<IconComponent />}
                label={
                  <Box sx={{ textAlign: 'center' }}>
                    <Typography variant="body2" sx={{ fontWeight: 'medium' }}>
                      {method.label}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {method.description}
                    </Typography>
                  </Box>
                }
                disabled={method.disabled || isInstalling}
                {...a11yProps(index)}
                sx={{
                  '&.Mui-selected': {
                    color: 'primary.main'
                  }
                }}
              />
            );
          })}
        </Tabs>
      </Paper>

      {/* Tab Content */}
      <TabPanel value={selectedTab} index={0}>
        <GitHubInstallForm
          onInstall={onInstall}
          isInstalling={isInstalling}
          onValidateUrl={onValidateUrl}
        />
      </TabPanel>

      <TabPanel value={selectedTab} index={1}>
        <LocalFileInstallForm
          onInstall={onInstall}
          isInstalling={isInstalling}
        />
      </TabPanel>

      {/* Future: Marketplace tab */}
      {/* <TabPanel value={selectedTab} index={2}>
        <MarketplaceInstallForm
          onInstall={onInstall}
          isInstalling={isInstalling}
        />
      </TabPanel> */}

      {/* Installation Method Info */}
      <Box sx={{ mt: 3, p: 3, bgcolor: 'background.paper', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
        <Typography variant="h6" gutterBottom>
          About {currentMethod.label}
        </Typography>
        
        {currentMethod.id === 'github' && (
          <Box>
            <Typography variant="body2" color="text.secondary" paragraph>
              Install plugins directly from GitHub repositories. This method:
            </Typography>
            <Box component="ul" sx={{ m: 0, pl: 2, color: 'text.secondary' }}>
              <li>Downloads the latest release or specified version</li>
              <li>Supports both public and private repositories (with authentication)</li>
              <li>Automatically validates plugin structure</li>
              <li>Provides version management and update notifications</li>
            </Box>
          </Box>
        )}

        {currentMethod.id === 'local-file' && (
          <Box>
            <Typography variant="body2" color="text.secondary" paragraph>
              Upload plugin archive files from your computer. This method:
            </Typography>
            <Box component="ul" sx={{ m: 0, pl: 2, color: 'text.secondary' }}>
              <li>Supports ZIP, RAR, and TAR.GZ archive formats</li>
              <li>Validates file structure before installation</li>
              <li>Ideal for testing custom or private plugins</li>
              <li>Maximum file size: 100MB</li>
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default InstallMethodTabs;