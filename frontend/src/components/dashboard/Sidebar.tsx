import {
  Drawer,
  Toolbar,
  useTheme,
  useMediaQuery,
  Box,
} from '@mui/material';
import { useEffect, useState, useCallback } from 'react';
import { PageNavigation } from '../PageNavigation';
import { usePages } from '../../hooks/usePages';
import { useSettings } from '../../contexts/ServiceContext';

interface SidebarProps {
  open: boolean;
  onClose: () => void;
  drawerWidth: number;
}

const Sidebar = ({ open, onClose, drawerWidth }: SidebarProps) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [mounted, setMounted] = useState(false);
  const { refreshPages } = usePages();
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const settingsService = useSettings();

  type PoweredBy = { text: string; link: string };
  const defaultPoweredBy: PoweredBy = {
    text: 'Powered by BrainDrive',
    link: 'https://community.braindrive.ai',
  };
  const [poweredBy, setPoweredBy] = useState<PoweredBy>(defaultPoweredBy);

  // Function to force a refresh of the sidebar
  const refreshSidebar = useCallback(() => {
    setRefreshTrigger(prev => prev + 1);
    refreshPages();
  }, [refreshPages]);

  // Make the refreshSidebar and refreshPages functions available globally
  useEffect(() => {
    // @ts-ignore
    window.refreshSidebar = refreshSidebar;
    // @ts-ignore
    window.refreshPages = refreshPages;
    
    return () => {
      // @ts-ignore
      delete window.refreshSidebar;
      // @ts-ignore
      delete window.refreshPages;
    };
  }, [refreshSidebar, refreshPages]);

  // Handle window resize
  useEffect(() => {
    setMounted(true);
  }, []);

  // Load Powered By settings
  useEffect(() => {
    let isActive = true;
    (async () => {
      try {
        const value = await settingsService.getSetting<any>('powered_by_settings');
        if (!isActive) return;
        if (value) {
          if (typeof value === 'string') {
            try {
              const parsed = JSON.parse(value);
              setPoweredBy({
                text: parsed?.text || defaultPoweredBy.text,
                link: parsed?.link || defaultPoweredBy.link,
              });
            } catch {
              setPoweredBy(defaultPoweredBy);
            }
          } else if (typeof value === 'object') {
            setPoweredBy({
              text: value?.text || defaultPoweredBy.text,
              link: value?.link || defaultPoweredBy.link,
            });
          }
        } else {
          setPoweredBy(defaultPoweredBy);
        }
      } catch {
        setPoweredBy(defaultPoweredBy);
      }
    })();
    return () => {
      isActive = false;
    };
    // We intentionally run once after mount and service ready
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!mounted) {
    return null;
  }

  const drawerContent = (
    <>
      <Toolbar /> {/* Spacer for header */}
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
        }}
      >
        <Box
          sx={{
            flexGrow: 1,
            overflow: 'auto',
            '&::-webkit-scrollbar': { width: '8px' },
            '&::-webkit-scrollbar-track': { background: 'transparent' },
            '&::-webkit-scrollbar-thumb': {
              background: (theme) => theme.palette.divider,
              borderRadius: '4px',
            },
            '&::-webkit-scrollbar-thumb:hover': {
              background: (theme) => theme.palette.action.hover,
            },
          }}
        >
          {/* Unified Navigation - Core routes and published pages in one component */}
          <PageNavigation key={`page-nav-${refreshTrigger}`} />
        </Box>
        <Box
          component="footer"
          sx={{
            borderTop: `1px solid ${theme.palette.divider}`,
            color: 'text.secondary',
            typography: 'caption',
            p: 1,
            textAlign: 'center',
          }}
        >
          <a
            href={poweredBy.link}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'inherit', textDecoration: 'none' }}
          >
            {poweredBy.text}
          </a>
        </Box>
      </Box>
    </>
  );

  return (
    <Box
      component="nav"
      sx={{
        width: { sm: drawerWidth },
        flexShrink: { sm: 0 },
      }}
    >
      {/* Mobile drawer */}
      <Drawer
        variant="temporary"
        open={isMobile ? open : false}
        onClose={onClose}
        ModalProps={{
          keepMounted: true, // Better mobile performance
        }}
        sx={{
          display: { xs: 'block', sm: 'none' },
          '& .MuiDrawer-paper': {
            width: drawerWidth,
            boxSizing: 'border-box',
            borderRight: `1px solid ${theme.palette.divider}`,
          },
        }}
      >
        {drawerContent}
      </Drawer>

      {/* Desktop drawer */}
      <Drawer
        variant="permanent"
        sx={{
          display: { xs: 'none', sm: 'block' },
          '& .MuiDrawer-paper': {
            width: drawerWidth,
            boxSizing: 'border-box',
            borderRight: `1px solid ${theme.palette.divider}`,
            transform: open ? 'translateX(0)' : `translateX(-${drawerWidth}px)`,
            visibility: open ? 'visible' : 'hidden',
            transition: theme.transitions.create(['transform', 'visibility'], {
              easing: theme.transitions.easing.sharp,
              duration: theme.transitions.duration.enteringScreen,
            }),
          },
        }}
        open={open}
      >
        {drawerContent}
      </Drawer>
    </Box>
  );
};

export default Sidebar;
