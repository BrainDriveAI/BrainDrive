import React, { useState, useCallback, useEffect } from 'react';
import {
  Box,
  TextField,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Typography,
  Paper,
  Alert,
  InputAdornment,
  IconButton,
  Tooltip,
  CircularProgress
} from '@mui/material';
import {
  GitHub as GitHubIcon,
  Help as HelpIcon,
  Clear as ClearIcon
} from '@mui/icons-material';
import { GitHubInstallRequest } from '../../types';

interface GitHubRelease {
  tag_name: string;
  name: string;
  published_at: string;
  prerelease: boolean;
}

interface GitHubInstallFormProps {
  onInstall: (request: GitHubInstallRequest) => void;
  isInstalling: boolean;
  onValidateUrl?: (url: string) => { isValid: boolean; error?: string };
}

const GitHubInstallForm: React.FC<GitHubInstallFormProps> = ({
  onInstall,
  isInstalling,
  onValidateUrl
}) => {
  const [repoUrl, setRepoUrl] = useState('');
  const [version, setVersion] = useState('latest');
  const [urlError, setUrlError] = useState<string | null>(null);
  const [releases, setReleases] = useState<GitHubRelease[]>([]);
  const [loadingReleases, setLoadingReleases] = useState(false);
  const [isGitHubUrl, setIsGitHubUrl] = useState(false);

  // Helper function to check if URL is a GitHub URL
  const isGitHubRepository = (url: string): boolean => {
    return /^https?:\/\/github\.com\/[^\/]+\/[^\/]+/i.test(url);
  };

  // Helper function to extract owner/repo from GitHub URL
  const extractGitHubInfo = (url: string): { owner: string; repo: string; tag?: string } | null => {
    const match = url.match(/^https?:\/\/github\.com\/([^\/]+)\/([^\/]+)(?:\/releases\/tag\/([^\/]+))?/i);
    if (match) {
      return {
        owner: match[1],
        repo: match[2].replace(/\.git$/, ''), // Remove .git suffix if present
        tag: match[3]
      };
    }
    return null;
  };

  // Helper function to get clean repository URL
  const getCleanRepoUrl = (url: string): string => {
    const info = extractGitHubInfo(url);
    if (info) {
      return `https://github.com/${info.owner}/${info.repo}`;
    }
    return url;
  };

  // Fetch GitHub releases
  const fetchGitHubReleases = async (owner: string, repo: string): Promise<GitHubRelease[]> => {
    try {
      const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases`);
      if (!response.ok) {
        throw new Error(`Failed to fetch releases: ${response.statusText}`);
      }
      const releases = await response.json();
      return releases.filter((release: GitHubRelease) => !release.prerelease);
    } catch (error) {
      console.error('Error fetching GitHub releases:', error);
      return [];
    }
  };

  const handleUrlChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const url = event.target.value;

    // Clear previous error and releases
    setUrlError(null);
    setReleases([]);
    setLoadingReleases(false);

    // Check if it's a GitHub URL
    const isGitHub = isGitHubRepository(url);
    setIsGitHubUrl(isGitHub);

    // Determine the final URL and version to set
    let finalUrl = url;
    let finalVersion = 'latest';

    // If it's a GitHub URL, handle tag URLs and clean the URL
    if (url.trim() && isGitHub) {
      const gitHubInfo = extractGitHubInfo(url);
      if (gitHubInfo) {
        // Always use the clean repository URL
        finalUrl = getCleanRepoUrl(url);

        // If URL contains a specific tag, auto-select it
        if (gitHubInfo.tag) {
          finalVersion = gitHubInfo.tag;
        }
      }
    }

    // Set the final URL and version
    setRepoUrl(finalUrl);
    setVersion(finalVersion);

    // Validate URL if provided
    if (finalUrl.trim() && onValidateUrl) {
      const validation = onValidateUrl(finalUrl);
      if (!validation.isValid) {
        setUrlError(validation.error || 'Invalid URL');
        return;
      }
    }

    // If it's a GitHub URL, fetch releases
    if (finalUrl.trim() && isGitHub) {
      const gitHubInfo = extractGitHubInfo(finalUrl);
      if (gitHubInfo) {
        // Fetch available releases
        setLoadingReleases(true);
        try {
          const fetchedReleases = await fetchGitHubReleases(gitHubInfo.owner, gitHubInfo.repo);
          setReleases(fetchedReleases);

          // If no specific tag was provided and we have releases, auto-select the latest
          if (!gitHubInfo.tag && fetchedReleases.length > 0) {
            setVersion(fetchedReleases[0].tag_name);
          }
        } catch (error) {
          console.error('Failed to fetch releases:', error);
        } finally {
          setLoadingReleases(false);
        }
      }
    }
  }, [onValidateUrl]);

  const handleClearUrl = useCallback(() => {
    setRepoUrl('');
    setUrlError(null);
    setReleases([]);
    setVersion('latest');
    setIsGitHubUrl(false);
    setLoadingReleases(false);
  }, []);

  const handleSubmit = useCallback((event: React.FormEvent) => {
    event.preventDefault();

    if (!repoUrl.trim()) {
      setUrlError('Repository URL is required');
      return;
    }

    if (onValidateUrl) {
      const validation = onValidateUrl(repoUrl);
      if (!validation.isValid) {
        setUrlError(validation.error || 'Invalid URL');
        return;
      }
    }

    onInstall({
      method: 'github',
      repo_url: getCleanRepoUrl(repoUrl.trim()),
      version: version || 'latest'
    });
  }, [repoUrl, version, onInstall, onValidateUrl]);

  const exampleUrls = [
    'https://github.com/user/awesome-plugin',
    'https://github.com/company/weather-widget',
    'https://github.com/DJJones66/NetworkEyes/releases/tag/1.0.7'
  ];

  return (
    <Paper sx={{ p: 3 }}>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <GitHubIcon />
          Install from GitHub Repository
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Install plugins directly from GitHub repositories. The plugin will be downloaded and installed for your account only.
        </Typography>
      </Box>

      <Box component="form" onSubmit={handleSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <TextField
          label="GitHub Repository URL"
          placeholder="https://github.com/user/plugin-name"
          value={repoUrl}
          onChange={handleUrlChange}
          error={!!urlError}
          helperText={urlError || 'Enter the GitHub repository URL for the plugin you want to install'}
          disabled={isInstalling}
          fullWidth
          required
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <GitHubIcon color="action" />
              </InputAdornment>
            ),
            endAdornment: repoUrl && (
              <InputAdornment position="end">
                <IconButton
                  onClick={handleClearUrl}
                  disabled={isInstalling}
                  size="small"
                  aria-label="Clear URL"
                >
                  <ClearIcon />
                </IconButton>
              </InputAdornment>
            )
          }}
        />

        {repoUrl.trim() && (
          <>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <FormControl fullWidth disabled={isInstalling}>
                <InputLabel>Version</InputLabel>
                <Select
                  value={version}
                  label="Version"
                  onChange={(e) => setVersion(e.target.value)}
                >
                  <MenuItem value="latest">Latest Release</MenuItem>
                  {isGitHubUrl && releases.length > 0 && releases.map((release) => (
                    <MenuItem key={release.tag_name} value={release.tag_name}>
                      {release.tag_name} {release.name && `- ${release.name}`}
                    </MenuItem>
                  ))}
                  {isGitHubUrl && releases.length === 0 && !loadingReleases && (
                    <MenuItem value="custom">Custom Version</MenuItem>
                  )}
                  {!isGitHubUrl && (
                    <MenuItem value="custom">Custom Version</MenuItem>
                  )}
                </Select>
              </FormControl>
              {loadingReleases && (
                <CircularProgress size={20} />
              )}
            </Box>

            {((version !== 'latest' && version === 'custom') ||
              (!isGitHubUrl && version !== 'latest') ||
              (isGitHubUrl && releases.length === 0 && version !== 'latest' && version !== 'custom')) && (
              <TextField
                label="Specific Version Tag"
                placeholder="v1.0.0"
                value={version === 'latest' || version === 'custom' ? '' : version}
                onChange={(e) => setVersion(e.target.value || 'latest')}
                disabled={isInstalling}
                fullWidth
                helperText="Enter the exact version tag from the repository releases"
              />
            )}
          </>
        )}

        <Alert severity="info" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 'medium', mb: 1 }}>
              Example URLs:
            </Typography>
            {exampleUrls.map((url, index) => (
              <Typography
                key={index}
                variant="body2"
                sx={{
                  fontFamily: 'monospace',
                  fontSize: '0.875rem',
                  cursor: 'pointer',
                  '&:hover': { textDecoration: 'underline' }
                }}
                onClick={() => !isInstalling && handleUrlChange({ target: { value: url } } as React.ChangeEvent<HTMLInputElement>)}
              >
                {url}
              </Typography>
            ))}
            <Typography variant="body2" sx={{ mt: 1, fontSize: '0.75rem', color: 'text.secondary' }}>
              • Repository URLs will auto-fetch available releases
              <br />
              • Release tag URLs will auto-select the specific version
            </Typography>
          </Box>
          <Tooltip title="Click on any example URL to use it">
            <HelpIcon fontSize="small" />
          </Tooltip>
        </Alert>

        <Box sx={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
          <Button
            type="submit"
            variant="contained"
            disabled={isInstalling || !!urlError || !repoUrl.trim()}
            sx={{ minWidth: 120 }}
          >
            {isInstalling ? 'Installing...' : 'Install Plugin'}
          </Button>
        </Box>
      </Box>
    </Paper>
  );
};

export default GitHubInstallForm;