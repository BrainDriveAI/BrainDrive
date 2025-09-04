import { useState, useEffect } from 'react';
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
  
  // Determine if the current URL is a page that should show title
  // This includes studio pages, regular pages, and any page that sets a title
  const shouldShowPageTitle = location.pathname.startsWith('/plugin-studio') ||
                              location.pathname.startsWith('/pages/') ||
                              location.pathname.startsWith('/page/') ||
                              // Also show for any page that has set a title
                              Boolean(window.currentPageTitle);
  
  // Effect to reset state when location changes
  useEffect(() => {
    // Reset the page title when navigating away from pages
    // But don't immediately clear it - let the new page set its title
    console.log('Header - Location changed to:', location.pathname);
  }, [location.pathname]);
  
  // Effect to check the global variables periodically
  useEffect(() => {
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
      pathname: location.pathname
    });
    
    // Set up an interval to check for changes
    const intervalId = setInterval(() => {
      // Update page title if it has changed
      if (window.currentPageTitle !== pageTitle) {
        if (window.currentPageTitle) {
          console.log('Header - Updating page title from global:', window.currentPageTitle);
          setPageTitle(window.currentPageTitle);
        } else {
          // Clear the title if it's been unset
          setPageTitle('');
        }
      }
      
      if (window.isStudioPage !== undefined && window.isStudioPage !== isStudioPage) {
        console.log('Header - Updating isStudioPage from global:', window.isStudioPage);
        setIsStudioPage(window.isStudioPage);
      }
    }, 500); // Check every 500ms
    
    // Clean up the interval when the component unmounts
    return () => clearInterval(intervalId);
  }, [pageTitle, isStudioPage, location.pathname]);

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
          
          {/* Display page title when available */}
          {pageTitle ? (
            <Typography
              variant="h6"
              sx={{
                ml: 2,
                display: 'flex',
                alignItems: 'center',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: '400px'
              }}
            >
              {pageTitle}
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
