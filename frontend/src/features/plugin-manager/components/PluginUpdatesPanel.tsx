import React from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  LinearProgress,
  Link,
  Skeleton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import SystemUpdateAltIcon from '@mui/icons-material/SystemUpdateAlt';
import RefreshIcon from '@mui/icons-material/Refresh';
import ScheduleIcon from '@mui/icons-material/Schedule';
import CloseIcon from '@mui/icons-material/Close';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import {
  PluginUpdateBatchProgress,
  PluginUpdateFeedItem,
  PluginUpdateFeedStatus,
} from '../hooks/usePluginUpdateFeed';

interface PluginUpdatesPanelProps {
  updates: PluginUpdateFeedItem[];
  status: PluginUpdateFeedStatus;
  error: string | null;
  lastChecked: string | null;
  isUpdatingAll: boolean;
  batchProgress: PluginUpdateBatchProgress;
  onUpdate: (pluginId: string) => void | Promise<void>;
  onUpdateAll: () => void | Promise<void>;
  onRefresh: () => void | Promise<void>;
  onDismiss: (pluginId: string) => void;
  onRetry: () => void | Promise<void>;
}

const formatTimestamp = (timestamp: string | null): string => {
  if (!timestamp) {
    return 'Never checked';
  }

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return 'Last check unknown';
  }

  return `Last checked ${date.toLocaleString()}`;
};

const formatPluginLabel = (plugin: PluginUpdateFeedItem): string => {
  if (plugin.pluginName && plugin.pluginName.trim()) {
    return plugin.pluginName;
  }

  const slug = plugin.pluginId.split('_').slice(1).join('_') || plugin.pluginId;
  const spaced = slug
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();

  if (!spaced) {
    return plugin.pluginId;
  }

  return spaced
    .split(' ')
    .map(part => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(' ');
};

const PluginUpdatesPanel: React.FC<PluginUpdatesPanelProps> = ({
  updates,
  status,
  error,
  lastChecked,
  isUpdatingAll,
  batchProgress,
  onUpdate,
  onUpdateAll,
  onRefresh,
  onDismiss,
  onRetry,
}) => {
  const showSkeleton = status === 'loading' && updates.length === 0 && !lastChecked;
  const showEmpty = status === 'empty';
  const showError = status === 'error';

  const lastCheckedLabel = formatTimestamp(lastChecked);
  const progressValue = batchProgress.total > 0 && batchProgress.processed <= batchProgress.total
    ? Math.round((batchProgress.processed / batchProgress.total) * 100)
    : 0;

  const renderHeaderActions = () => (
    <Stack direction="row" spacing={1} alignItems="center">
      <Tooltip title="Refresh now">
        <span>
          <IconButton
            color="primary"
            onClick={() => onRefresh()}
            disabled={status === 'loading'}
            size="small"
          >
            <RefreshIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      <Button
        variant="contained"
        onClick={() => onUpdateAll()}
        disabled={updates.length === 0 || isUpdatingAll}
        startIcon={
          isUpdatingAll ? <CircularProgress size={16} color="inherit" /> : <SystemUpdateAltIcon fontSize="small" />
        }
      >
        {isUpdatingAll ? 'Updating...' : 'Update All'}
      </Button>
    </Stack>
  );

  const renderProgress = () => {
    if (!isUpdatingAll && batchProgress.processed === 0) {
      return null;
    }

    return (
      <Box mt={2}>
        <LinearProgress
          variant={batchProgress.total > 0 ? 'determinate' : 'indeterminate'}
          value={batchProgress.total > 0 ? progressValue : undefined}
        />
        {batchProgress.total > 0 && (
          <Typography variant="caption" color="text.secondary" display="block" mt={1}>
            {`Processed ${batchProgress.processed} of ${batchProgress.total} (Success: ${batchProgress.succeeded}, Failed: ${batchProgress.failed})`}
          </Typography>
        )}
      </Box>
    );
  };

  const renderError = () => {
    if (!showError) {
      return null;
    }

    return (
      <Box mt={2}>
        <Alert
          severity="error"
          icon={<ErrorOutlineIcon fontSize="small" />}
          action={
            <Button color="inherit" size="small" onClick={() => onRetry()}>
              Retry
            </Button>
          }
        >
          {error || 'We hit a snag while checking for plugin updates.'}
        </Alert>
      </Box>
    );
  };

  const renderEmpty = () => {
    if (!showEmpty) {
      return null;
    }

    return (
      <Box mt={2}>
        <Alert severity="info" icon={<InfoOutlinedIcon fontSize="small" />}>No plugins need updates right now.</Alert>
      </Box>
    );
  };

  const renderSkeleton = () => {
    if (!showSkeleton) {
      return null;
    }

    return (
      <Stack spacing={2} mt={2}>
        {Array.from({ length: 3 }).map((_, index) => (
          <Box key={`plugin-update-skeleton-${index}`}>
            <Skeleton variant="text" width="30%" height={28} />
            <Skeleton variant="text" width="45%" height={24} />
            <Skeleton variant="rectangular" width="100%" height={40} sx={{ mt: 1 }} />
          </Box>
        ))}
      </Stack>
    );
  };

  const renderUpdates = () => {
    if (showSkeleton || showEmpty) {
      return null;
    }

    return (
      <Stack
        mt={2}
        spacing={2}
        divider={<Divider flexItem sx={{ borderColor: 'divider', opacity: 0.5 }} />}
      >
        {updates.map(update => {
          const isProcessing = update.status === 'updating';

          return (
            <Box
              key={update.pluginId}
              sx={{
                display: 'flex',
                flexDirection: { xs: 'column', md: 'row' },
                alignItems: { xs: 'flex-start', md: 'center' },
                justifyContent: 'space-between',
                gap: 2,
              }}
            >
              <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                <Typography variant="subtitle1" sx={{ wordBreak: 'break-word' }}>
                  {formatPluginLabel(update)}
                </Typography>
                <Stack direction="row" spacing={1} alignItems="center" mt={0.5} flexWrap="wrap">
                  <Chip size="small" label={`Current ${update.currentVersion || 'n/a'}`} variant="outlined" />
                  <Chip size="small" label={`Latest ${update.latestVersion || 'n/a'}`} color="primary" />
                  <Stack direction="row" spacing={0.5} alignItems="center">
                    <ScheduleIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                    <Typography variant="caption" color="text.secondary">
                      {update.lastChecked ? new Date(update.lastChecked).toLocaleString() : 'Not yet checked'}
                    </Typography>
                  </Stack>
                </Stack>
                {update.repoUrl && (
                  <Typography variant="caption" color="text.secondary" display="block" mt={0.5}>
                    <Link href={update.repoUrl} target="_blank" rel="noopener">
                      {update.repoUrl}
                    </Link>
                  </Typography>
                )}
                {update.status === 'error' && update.error && (
                  <Alert severity="warning" sx={{ mt: 1 }}>
                    {update.error}
                  </Alert>
                )}
              </Box>
              <Stack direction="row" spacing={1} alignItems="center">
                <Button
                  variant="contained"
                  color="primary"
                  onClick={() => onUpdate(update.pluginId)}
                  disabled={isProcessing || isUpdatingAll}
                  startIcon={
                    isProcessing ? <CircularProgress size={16} color="inherit" /> : <SystemUpdateAltIcon fontSize="small" />
                  }
                >
                  {isProcessing ? 'Updating...' : 'Update'}
                </Button>
                <Button
                  variant="text"
                  color="inherit"
                  onClick={() => onDismiss(update.pluginId)}
                  startIcon={<CloseIcon fontSize="small" />}
                >
                  Later
                </Button>
              </Stack>
            </Box>
          );
        })}
      </Stack>
    );
  };

  return (
    <Card>
      <CardContent sx={{ p: 3 }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          alignItems={{ xs: 'flex-start', sm: 'center' }}
          justifyContent="space-between"
        >
          <Box>
            <Typography variant="h6">Plugin updates</Typography>
            <Stack direction="row" spacing={0.75} alignItems="center" mt={0.5}>
              <ScheduleIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
              <Typography variant="caption" color="text.secondary">
                {lastCheckedLabel}
              </Typography>
            </Stack>
          </Box>
          {renderHeaderActions()}
        </Stack>

        {renderProgress()}
        {renderError()}
        {renderSkeleton()}
        {renderEmpty()}
        {renderUpdates()}
      </CardContent>
    </Card>
  );
};

export default PluginUpdatesPanel;



