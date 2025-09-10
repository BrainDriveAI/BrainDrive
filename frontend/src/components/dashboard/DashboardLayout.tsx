import { useEffect, useState } from 'react';
import { Box, Toolbar, useMediaQuery, useTheme } from '@mui/material';
import { Outlet } from 'react-router-dom';
import Header from './Header';
import Sidebar from './Sidebar';
import { ThemeSelector } from '../ThemeSelector';
import { useSettings } from '../../contexts/ServiceContext';

const DRAWER_WIDTH = 240;

const DashboardLayout = () => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [sidebarOpen, setSidebarOpen] = useState(!isMobile);
  const settingsService = useSettings();
  const defaultCopyright = { text: 'AIs can make mistakes. Check important info.' };
  const [copyright, setCopyright] = useState(defaultCopyright);

  // Update sidebar state when screen size changes
  useEffect(() => {
    setSidebarOpen(!isMobile);
  }, [isMobile]);

  // Load copyright setting
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const value = await settingsService.getSetting<any>('copyright_settings');
        if (!active) return;
        if (value) {
          if (typeof value === 'string') {
            try {
              const parsed = JSON.parse(value);
              if (parsed && parsed.text) {
                // Only update if we have text; else keep default
                // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
                setCopyright({ text: parsed.text });
              }
            } catch {
              // Ignore parse errors, keep default
            }
          } else if (typeof value === 'object' && value.text) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
            setCopyright({ text: value.text });
          }
        }
      } catch {
        // Keep default on error
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleToggleSidebar = () => {
    setSidebarOpen(!sidebarOpen);
  };

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <Header 
        onToggleSidebar={handleToggleSidebar} 
        rightContent={<ThemeSelector />}
        sidebarOpen={sidebarOpen}
      />
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        drawerWidth={DRAWER_WIDTH}
      />
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: { xs: 1, sm: 2 },
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          marginLeft: {
            xs: 0,
            sm: sidebarOpen ? 0 : `-${DRAWER_WIDTH}px`
          },
          transition: theme.transitions.create(['margin'], {
            easing: theme.transitions.easing.easeOut,
            duration: theme.transitions.duration.enteringScreen,
          }),
        }}
      >
        <Toolbar /> {/* Spacer for header */}
        <Box
          sx={{
            maxWidth: '100%',
            overflow: 'hidden',
            flexGrow: 1,
          }}
        >
          <Outlet />
        </Box>
        <Box
          component="footer"
          sx={{
            borderTop: `1px solid ${theme.palette.divider}`,
            color: 'text.secondary',
            typography: 'caption',
            textAlign: 'center',
            pt: 1,
            mt: 1,
          }}
        >
          {copyright.text}
        </Box>
      </Box>
    </Box>
  );
};

export default DashboardLayout;
