/**
 * LayoutCommitBadge - Dev-only component for displaying layout commit status
 * Part of Phase 1: Instrumentation & Verification
 */

import React, { useState, useEffect } from 'react';
import { Box, Typography, Chip, Paper } from '@mui/material';
import { getLayoutCommitTracker } from '../utils/layoutCommitTracker';
import { useUnifiedLayoutState } from '../hooks/useUnifiedLayoutState';

export interface LayoutCommitBadgeProps {
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
}

export const LayoutCommitBadge: React.FC<LayoutCommitBadgeProps> = ({ 
  position = 'bottom-right' 
}) => {
  const [commitInfo, setCommitInfo] = useState<{
    version: number;
    hash: string;
    timestamp: number;
    hasPending: boolean;
  } | null>(null);
  
  const [timeSinceCommit, setTimeSinceCommit] = useState<string>('');
  
  // Only render in debug mode
  const isDebugMode = import.meta.env.VITE_LAYOUT_DEBUG === 'true';
  
  // Get the layout commit tracker
  const tracker = getLayoutCommitTracker();
  
  // Update commit info periodically
  useEffect(() => {
    if (!isDebugMode) return;
    
    const updateInfo = () => {
      const lastCommit = tracker.getLastCommit();
      const hasPending = tracker.hasPendingCommits();
      
      if (lastCommit) {
        setCommitInfo({
          version: lastCommit.version,
          hash: lastCommit.hash,
          timestamp: lastCommit.timestamp,
          hasPending
        });
        
        // Calculate time since commit
        const elapsed = Date.now() - lastCommit.timestamp;
        if (elapsed < 1000) {
          setTimeSinceCommit('just now');
        } else if (elapsed < 60000) {
          setTimeSinceCommit(`${Math.floor(elapsed / 1000)}s ago`);
        } else if (elapsed < 3600000) {
          setTimeSinceCommit(`${Math.floor(elapsed / 60000)}m ago`);
        } else {
          setTimeSinceCommit(`${Math.floor(elapsed / 3600000)}h ago`);
        }
      }
    };
    
    // Update immediately
    updateInfo();
    
    // Update every second
    const interval = setInterval(updateInfo, 1000);
    
    return () => clearInterval(interval);
  }, [isDebugMode, tracker]);
  
  // Don't render if not in debug mode
  if (!isDebugMode) {
    return null;
  }
  
  // Position styles
  const positionStyles = {
    'top-left': { top: 16, left: 16 },
    'top-right': { top: 16, right: 16 },
    'bottom-left': { bottom: 16, left: 16 },
    'bottom-right': { bottom: 16, right: 16 }
  };
  
  return (
    <Paper
      elevation={3}
      sx={{
        position: 'fixed',
        ...positionStyles[position],
        zIndex: 9999,
        padding: 1.5,
        backgroundColor: 'background.paper',
        border: '1px solid',
        borderColor: commitInfo?.hasPending ? 'warning.main' : 'success.main',
        minWidth: 200,
        opacity: 0.95,
        '&:hover': {
          opacity: 1
        }
      }}
    >
      <Typography variant="caption" sx={{ fontWeight: 'bold', display: 'block', mb: 0.5 }}>
        Layout Commit Status
      </Typography>
      
      {commitInfo ? (
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
            <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
              v{commitInfo.version}
            </Typography>
            <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'text.secondary' }}>
              #{commitInfo.hash.substring(0, 6)}
            </Typography>
          </Box>
          
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Chip
              label={commitInfo.hasPending ? 'Pending' : 'Committed'}
              size="small"
              color={commitInfo.hasPending ? 'warning' : 'success'}
              sx={{ height: 20, fontSize: '0.7rem' }}
            />
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {timeSinceCommit}
            </Typography>
          </Box>
        </Box>
      ) : (
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          No commits yet
        </Typography>
      )}
    </Paper>
  );
};

// Export a hook to use the badge programmatically
export const useLayoutCommitBadge = () => {
  const [isVisible, setIsVisible] = useState(false);
  
  const show = () => setIsVisible(true);
  const hide = () => setIsVisible(false);
  const toggle = () => setIsVisible(prev => !prev);
  
  return {
    isVisible,
    show,
    hide,
    toggle
  };
};