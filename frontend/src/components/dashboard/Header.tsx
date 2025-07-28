import { useState, useEffect, useMemo } from 'react';
import {
  AppBar,
  Box,
  IconButton,
  Toolbar,
  Typography,
  Menu,
  MenuItem,
  useTheme,
  Avatar,
  Divider,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import MenuOpenIcon from '@mui/icons-material/MenuOpen';
import { useAuth } from '../../contexts/AuthContext';
import { useLocation } from 'react-router-dom';

// Declare a global interface for the Window object
declare global {
  interface Window {
    currentPageTitle?: string;
    isStudioPage?: boolean;
  }
}

interface HeaderProps {
  onToggleSidebar: () => void;
  rightContent?: React.ReactNode;
  sidebarOpen: boolean;
}

const Header = ({ onToggleSidebar, rightContent, sidebarOpen }: HeaderProps) => {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const theme = useTheme();
  const { user, logout } = useAuth();
  const location = useLocation();
  
  // State to track the global variables
  const [pageTitle, setPageTitle] = useState<string>('');
  const [isStudioPage, setIsStudioPage] = useState<boolean>(false);
  
  // Determine if the current URL is a studio page - aligned with DynamicPageRenderer logic
  const isCurrentPathStudioPage = useMemo(() => {
    console.log('[Header] Determining isCurrentPathStudioPage for path:', location.pathname);
    
    if (location.pathname.startsWith('/plugin-studio')) {
      console.log('[Header] → Studio interface detected: true');
      return true;
    }
    
    if (location.pathname.startsWith('/pages/')) {
      const hasStudioParam = new URLSearchParams(location.search).has('studio');
      console.log('[Header] → Page with studio param:', hasStudioParam);
      return hasStudioParam;
    }
    
    console.log('[Header] → Default: false');
    return false;
  }, [location.pathname, location.search]);
  
  // Effect to reset state when location changes
  useEffect(() => {
    if (!isCurrentPathStudioPage) {
      setPageTitle('');
      setIsStudioPage(false);
      window.currentPageTitle = undefined;
      window.isStudioPage = false;
      console.log('Header - Reset state because not on a studio page');
    }
  }, [location.pathname, isCurrentPathStudioPage]);
  
  // Effect to check the global variables periodically
  useEffect(() => {
    // Only check for updates if we're on a studio page
    if (!isCurrentPathStudioPage) {
      return;
    }
    
    // Initial check
    if (window.currentPageTitle) {
      setPageTitle(window.currentPageTitle);
    }
    if (window.isStudioPage !== undefined) {
      setIsStudioPage(window.isStudioPage);
    }
    
    console.log('Header - Initial global variables:', {
      currentPageTitle: window.currentPageTitle,
      isStudioPage: window.isStudioPage,
      isCurrentPathStudioPage
    });
    
    // Set up an interval to check for changes
    const intervalId = setInterval(() => {
      if (window.currentPageTitle && window.currentPageTitle !== pageTitle) {
        console.log('Header - Updating page title from global:', window.currentPageTitle);
        setPageTitle(window.currentPageTitle);
      }
      
      if (window.isStudioPage !== undefined && window.isStudioPage !== isStudioPage) {
        console.log('Header - Updating isStudioPage from global:', window.isStudioPage);
        setIsStudioPage(window.isStudioPage);
      }
    }, 500); // Check every 500ms
    
    // Clean up the interval when the component unmounts
    return () => clearInterval(intervalId);
  }, [pageTitle, isStudioPage, isCurrentPathStudioPage]);

  const handleMenu = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleLogout = async () => {
    try {
      await logout();
    } catch (error) {
      console.error('Logout failed:', error);
    }
    handleClose();
  };

  return (
    <AppBar 
      position="fixed" 
      sx={{ 
        zIndex: (theme) => theme.zIndex.drawer + 1,
        backgroundColor: theme.palette.background.paper,
        color: theme.palette.text.primary,
        borderBottom: `1px solid ${theme.palette.divider}`,
      }}
      elevation={0}
    >
      <Toolbar>
        <Box 
          sx={{ 
            flexGrow: 1,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <img 
            src={theme.palette.mode === 'dark' 
              ? '/braindrive/braindrive-dark.svg' 
              : '/braindrive/braindrive-light.svg'
            } 
            alt="BrainDrive.ai Plugin Studio"
            style={{
              height: '32px',
              width: 'auto',
              maxWidth: '250px',
            }}
          />
          <IconButton
            color="inherit"
            aria-label={sidebarOpen ? "close sidebar" : "open sidebar"}
            onClick={onToggleSidebar}
            sx={{
              ml: 2,
              transition: theme.transitions.create(['transform', 'margin'], {
                easing: theme.transitions.easing.sharp,
                duration: theme.transitions.duration.enteringScreen,
              }),
            }}
          >
            {sidebarOpen ? <MenuOpenIcon /> : <MenuIcon />}
          </IconButton>
          
          {/* Display page title for studio pages */}
          {isStudioPage && isCurrentPathStudioPage ? (
            <Typography
              variant="h6"
              sx={{
                ml: 2,
                display: 'flex',
                alignItems: 'center',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
            >
              {pageTitle || 'No Title Available'}
            </Typography>
          ) : null}
        </Box>
        {rightContent}
        <Box sx={{ display: 'flex', alignItems: 'center', ml: 2 }}>
          <Typography variant="body2" sx={{ mr: 2 }}>
            {user?.email}
          </Typography>
          <IconButton
            onClick={handleMenu}
            size="small"
            sx={{ ml: 2 }}
            aria-controls={Boolean(anchorEl) ? 'account-menu' : undefined}
            aria-haspopup="true"
            aria-expanded={Boolean(anchorEl) ? 'true' : undefined}
          >
            <Avatar sx={{ width: 32, height: 32 }}>
              {user?.username?.[0]?.toUpperCase() || 'U'}
            </Avatar>
          </IconButton>
        </Box>
        <Menu
          id="account-menu"
          anchorEl={anchorEl}
          open={Boolean(anchorEl)}
          onClose={handleClose}
          onClick={handleClose}
          PaperProps={{
            elevation: 0,
            sx: {
              overflow: 'visible',
              filter: 'drop-shadow(0px 2px 8px rgba(0,0,0,0.32))',
              mt: 1.5,
              '& .MuiAvatar-root': {
                width: 32,
                height: 32,
                ml: -0.5,
                mr: 1,
              },
            },
          }}
          transformOrigin={{ horizontal: 'right', vertical: 'top' }}
          anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
        >
          <MenuItem onClick={() => {
            handleClose();
            window.location.href = '/profile';
          }}>
            <Avatar>{user?.username?.[0]?.toUpperCase() || 'U'}</Avatar>
            Profile
          </MenuItem>
          <Divider />
          <MenuItem onClick={handleLogout}>
            Logout
          </MenuItem>
        </Menu>
      </Toolbar>
    </AppBar>
  );
};

export default Header;
