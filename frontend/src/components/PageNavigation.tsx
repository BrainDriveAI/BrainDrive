import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Collapse,
  Box,
  Typography,
  ListItemButton
} from '@mui/material';
import ExpandLess from '@mui/icons-material/ExpandLess';
import ExpandMore from '@mui/icons-material/ExpandMore';
import FolderIcon from '@mui/icons-material/Folder';
import PageIcon from '@mui/icons-material/Description';
import DashboardIcon from '@mui/icons-material/Dashboard';
import ExtensionIcon from '@mui/icons-material/Extension';
import SettingsIcon from '@mui/icons-material/Settings';
import CollectionsBookmarkIcon from '@mui/icons-material/CollectionsBookmark';
import { usePages, PageHierarchy } from '../hooks/usePages';
import { IconResolver } from './IconResolver';
import { navigationService } from '../services/navigationService';
import { defaultPageService } from '../services/defaultPageService';
import { NavigationRoute } from '../types/navigation';

// Your Pages navigation item
const yourPagesNavItem = { 
  id: 'your-pages', 
  name: 'Your Pages', 
  icon: <CollectionsBookmarkIcon />, 
  path: '/pages' 
};

// Names of pages that should be excluded from the top level
// Removed 'Home' from the excluded list to allow it to appear in "Your Pages"
const excludedPageNames: string[] = [];

interface PageNavigationProps {
  basePath?: string; // Optional base path for all page links
}

export const PageNavigation: React.FC<PageNavigationProps> = ({ basePath = '/pages' }) => {
  const { pageHierarchy, isLoading, error } = usePages();
  const location = useLocation();
  const navigate = useNavigate();

  // Track which core items are expanded
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    dashboard: true,
    'plugin-studio': true,
    settings: true,
    'your-pages': true
  });

  // Create a custom navigation items array that includes system routes and Your Pages
  const [coreNavItems, setCoreNavItems] = useState<any[]>([]);
  const [navigationRoutes, setNavigationRoutes] = useState<NavigationRoute[]>([]);
  const [systemRoutes, setSystemRoutes] = useState<NavigationRoute[]>([]);

  // Fetch navigation routes
  useEffect(() => {
    const fetchNavigationRoutes = async () => {
      try {
        //console.log('PageNavigation: Fetching navigation routes');
        const routes = await navigationService.getNavigationRoutes();
        //console.log('PageNavigation: Fetched navigation routes:', routes);
        
        // Separate system routes from custom routes
        const systemRoutes = routes.filter(route => route.is_system_route);
        const customRoutes = routes.filter(route => !route.is_system_route);
        
        setSystemRoutes(systemRoutes);
        setNavigationRoutes(customRoutes);
        
        // Expand all navigation route sections by default
        const newExpandedSections = { ...expandedSections };
        routes.forEach((route: NavigationRoute) => {
          newExpandedSections[route.route] = true;
        });
        setExpandedSections(newExpandedSections);
      } catch (err: any) {
        console.error('Error fetching navigation routes:', err.message);
      }
    };

    fetchNavigationRoutes();
  }, []);

  // Create core navigation items from system routes and add Your Pages
  useEffect(() => {
    if (systemRoutes.length > 0) {
      // Convert system routes to core nav items
      const systemNavItems = systemRoutes
        .sort((a, b) => (a.order || 0) - (b.order || 0))
        .map(route => ({
          id: route.route,
          name: route.name,
          icon: route.icon ? <IconResolver icon={route.icon} /> : 
                 route.route === 'dashboard' ? <DashboardIcon /> :
                 route.route === 'plugin-studio' ? <ExtensionIcon /> :
                 route.route === 'settings' ? <SettingsIcon /> :
                 <FolderIcon />,
          path: `/${route.route}`,
          isSystemRoute: true,
          defaultComponentId: route.default_component_id,
          defaultPageId: route.default_page_id,
          canChangeDefault: route.can_change_default
        }));
      
      // Add Your Pages to the core nav items
      setCoreNavItems([...systemNavItems, yourPagesNavItem]);
    }
  }, [systemRoutes]);

  const toggleSection = (sectionId: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [sectionId]: !prev[sectionId]
    }));
  };

  if (isLoading) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="body2" color="text.secondary">
          Loading pages...
        </Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="body2" color="error">
          Error loading pages
        </Typography>
      </Box>
    );
  }

  // Get all pages that have a parent (either parent_route or parent_type)
  const pagesWithParent = new Set<string>();

  // First collect all pages that have a parent
  Object.values(pageHierarchy).forEach(pages => {
    pages.forEach(page => {
      // Check if page has a parent
      if ((page.parent_route && page.parent_route !== '') ||
          (page.parent_type && page.parent_type !== 'page') ||
          page.navigation_route_id) {
        pagesWithParent.add(page.id);
      }
    });
  });

  // Get pages without a specific route (for "Your Pages" section)
  const pagesWithoutRoute = pageHierarchy.root.filter(page => 
    page.is_published && // Only include published pages
    !page.navigation_route_id && 
    !page.parent_route && 
    (!page.parent_type || page.parent_type === 'page') &&
    !excludedPageNames.includes(page.name)
  );

  // Create a set of page IDs that are in the "Your Pages" section
  const yourPagesIds = new Set(pagesWithoutRoute.map(page => page.id));

  // Create a set of page IDs that have a navigation_route_id
  const navigationRoutePageIds = new Set(
    pageHierarchy.root
      .filter(page => page.navigation_route_id)
      .map(page => page.id)
  );

  // Filter out pages from root that have a parent, are in "Your Pages", or have a navigation_route_id
  const filteredRootPages = pageHierarchy.root.filter(page =>
    !pagesWithParent.has(page.id) && 
    !yourPagesIds.has(page.id) && // Exclude pages that are in "Your Pages"
    !navigationRoutePageIds.has(page.id) // Exclude pages that have a navigation_route_id
  );

  // Further filter root pages to exclude specific page names
  const finalRootPages = filteredRootPages.filter(page =>
    !excludedPageNames.includes(page.name)
  );

  // Create a combined list of all routes (system and custom)
  const allRoutes = [...systemRoutes, ...navigationRoutes]
    .filter(route => route.is_visible)
    .sort((a, b) => (a.order || 0) - (b.order || 0));

  // Find the "Your Pages" item
  const yourPagesItem = coreNavItems.find(item => item.id === 'your-pages');

  return (
    <List component="nav" sx={{ width: '100%' }}>
      {/* Combined list of system and custom routes - sorted by order */}
      {allRoutes.map(route => {
        // Get pages associated with this route by navigation_route_id
        const routePages = pageHierarchy.root.filter(page => 
          page.navigation_route_id === route.id
        );
        
        // For system routes, also include pages with matching parent_type
        const coreRoutePages = route.is_system_route && pageHierarchy[route.route] 
          ? pageHierarchy[route.route] 
          : [];
        
        // Combine both types of pages
        const allRoutePages = [...routePages, ...coreRoutePages];

        const hasChildren = allRoutePages.length > 0;
        
        // Check if there are any non-default pages to display
        // This is used to determine whether to show the expand/collapse arrows
        const hasNonDefaultPages = allRoutePages.filter(page => {
          if (!route.default_page_id) return true;
          
          // Direct comparison
          if (page.id === route.default_page_id) return false;
          
          // Compare without hyphens
          const pageIdNoHyphens = page.id.replace(/-/g, '');
          const defaultPageIdNoHyphens = typeof route.default_page_id === 'string'
            ? route.default_page_id.replace(/-/g, '')
            : route.default_page_id;
          
          if (pageIdNoHyphens === defaultPageIdNoHyphens) return false;
          
          // If all comparisons pass, keep the page
          return true;
        }).length > 0;
        
        const isExpanded = expandedSections[route.route] || false;
        const isActive = location.pathname === `/${route.route}`;

        return (
          <React.Fragment key={route.id}>
            <ListItemButton
              selected={isActive}
              onClick={() => {
                // Toggle the section if it has children
                if (hasChildren) {
                  toggleSection(route.route);
                }
                
                // We now allow navigation to all routes, even if they don't have default content
                // The RouteContentRenderer will display the BannerPage for routes without default content
                //console.log(`Navigating to route: ${route.route}, has default content: ${!!(route.default_page_id || route.default_component_id || route.is_system_route)}`);
                
                // Log the navigation action for debugging
                //console.log(`Navigating to route: ${route.route}`, {
                //  default_page_id: route.default_page_id,
                //  default_component_id: route.default_component_id,
                //  is_system_route: route.is_system_route
                //});
                
  // Utility function to normalize UUIDs by removing hyphens
  const normalizeUuid = (id: string): string => {
    if (!id) return id;
    return id.replace(/-/g, '');
  };

  // If the route has a default page, navigate to that page
  if (route.default_page_id) {
    //console.log(`Route has default page ID: ${route.default_page_id}, navigating to page`);
    
    // Find the page using normalized UUID comparison
    const normalizedDefaultPageId = normalizeUuid(route.default_page_id);
    //console.log(`Normalized default page ID: ${normalizedDefaultPageId}`);
    
    let defaultPage = pageHierarchy.root.find(page => 
      normalizeUuid(page.id) === normalizedDefaultPageId
    );
                  
                  if (defaultPage) {
                    //console.log(`Found default page in hierarchy: ${defaultPage.name}, route: ${defaultPage.route}, published: ${defaultPage.is_published}`);
                    // Navigate to the page route
                    navigate(`/pages/${defaultPage.route}`);
                    return;
                  } else {
                    //console.log(`Default page not found in hierarchy, fetching from API`);
                    
                    // If we can't find the page in the hierarchy, fetch it directly from the API
                    // This is an async operation, so we need to handle it properly
                    const fetchPageAndNavigate = async () => {
                      try {
                        // Try with the normalized ID using defaultPageService
                        //console.log(`Fetching page with ID: ${route.default_page_id}`);
                        const normalizedId = normalizeUuid(String(route.default_page_id));
                        //console.log(`Using normalized ID for API fetch: ${normalizedId}`);
                        
                        // Use defaultPageService to handle unpublished pages
                        const page = await defaultPageService.getDefaultPage(normalizedId);
                        
                        if (page) {
                          //console.log(`Found page via defaultPageService: ${page.name}, route: ${page.route}, published: ${page.is_published}`);
                          
                          // Always navigate to the page route, even if the page is not published
                          // The DynamicPageRenderer will handle the unpublished page with allowUnpublished=true
                          //console.log(`Navigating to page route: /pages/${page.route}, published: ${page.is_published}`);
                          navigate(`/pages/${page.route}`);
                          return;
                        }
                        
                        // If all else fails, navigate to the route path
                        //console.log(`Could not find page via API, navigating to route path: /${route.route}`);
                        navigate(`/${route.route}`);
                      } catch (error) {
                        console.error('Error fetching page:', error);
                        // If there's an error, fall back to the route path
                        navigate(`/${route.route}`);
                      }
                    };
                    
                    fetchPageAndNavigate();
                    return;
                  }
                }
                
                // Navigate to the route path if it has a default component or is a system route
                navigate(`/${route.route}`);
              }}
              sx={{
                borderRadius: 1,
                mx: 1,
                mb: 0.5,
                '&.Mui-selected': {
                  bgcolor: 'action.selected',
                  color: 'primary.main',
                  '&:hover': {
                    bgcolor: 'action.hover',
                  }
                }
              }}
            >
              <ListItemIcon
                sx={{
                  color: isActive ? 'primary.main' : 'inherit',
                  minWidth: '32px'
                }}
              >
                {route.icon ? (
                  <IconResolver icon={route.icon} />
                ) : route.route === 'dashboard' ? (
                  <DashboardIcon />
                ) : route.route === 'plugin-studio' ? (
                  <ExtensionIcon />
                ) : route.route === 'settings' ? (
                  <SettingsIcon />
                ) : (
                  <FolderIcon />
                )}
              </ListItemIcon>
              <ListItemText
                primary={route.name}
                sx={{
                  '& .MuiListItemText-primary': {
                    color: isActive ? 'primary.main' : 'inherit',
                    fontWeight: isActive ? 600 : 400
                  }
                }}
              />
              {/* Only show expand/collapse arrows if there are non-default pages to display */}
              {hasNonDefaultPages && (isExpanded ? <ExpandLess /> : <ExpandMore />)}
            </ListItemButton>

            {/* Pages for this route - excluding the default page */}
            {hasChildren && (
              <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                <List component="div" disablePadding sx={{ pl: 2 }}>
                  {[...allRoutePages]
                    // Filter out the default page if it exists, handling different ID formats
                    .filter(page => {
                      if (!route.default_page_id) return true;
                      
                      // Direct comparison
                      if (page.id === route.default_page_id) return false;
                      
                      // Compare without hyphens
                      const pageIdNoHyphens = page.id.replace(/-/g, '');
                      const defaultPageIdNoHyphens = typeof route.default_page_id === 'string' 
                        ? route.default_page_id.replace(/-/g, '')
                        : route.default_page_id;
                      
                      if (pageIdNoHyphens === defaultPageIdNoHyphens) return false;
                      
                      // If all comparisons pass, keep the page
                      return true;
                    })
                    .sort((a, b) => (a.navigation_order || 0) - (b.navigation_order || 0))
                    .map(page => {
                    const pagePath = `${basePath}/${page.route}`;
                    const isChildActive = location.pathname === pagePath;

                    return (
                      <ListItem
                        key={page.id}
                        component={Link}
                        to={pagePath}
                        selected={isChildActive}
                        sx={{
                          color: 'text.primary',
                          '&.Mui-selected': {
                            bgcolor: 'action.selected',
                            color: 'primary.main'
                          },
                          '&:hover': {
                            bgcolor: 'action.hover'
                          }
                        }}
                      >
                        <ListItemIcon sx={{ minWidth: '32px' }}>
                          {page.icon ? (
                            <IconResolver icon={page.icon} />
                          ) : (
                            <PageIcon />
                          )}
                        </ListItemIcon>
                        <ListItemText primary={page.name} />
                      </ListItem>
                    );
                  })}
                </List>
              </Collapse>
            )}
          </React.Fragment>
        );
      })}

      {/* Your Pages section - always at the bottom */}
      {yourPagesItem && (
        <React.Fragment key={yourPagesItem.id}>
          <ListItemButton
            selected={location.pathname === yourPagesItem.path}
            onClick={() => {
              // Always toggle the section if it has children
              const hasChildren = pagesWithoutRoute.length > 0;
              if (hasChildren) {
                toggleSection(yourPagesItem.id);
              }
              // Always navigate to the path regardless of whether it has children
              navigate(yourPagesItem.path);
            }}
            sx={{
              borderRadius: 1,
              mx: 1,
              mb: 0.5,
              mt: 2, // Add margin top to separate from other routes
              '&.Mui-selected': {
                bgcolor: 'action.selected',
                color: 'primary.main',
                '&:hover': {
                  bgcolor: 'action.hover',
                }
              }
            }}
          >
            <ListItemIcon
              sx={{
                color: location.pathname === yourPagesItem.path ? 'primary.main' : 'inherit',
                minWidth: '32px'
              }}
            >
              {yourPagesItem.icon}
            </ListItemIcon>
            <ListItemText
              primary={yourPagesItem.name}
              sx={{
                '& .MuiListItemText-primary': {
                  color: location.pathname === yourPagesItem.path ? 'primary.main' : 'inherit',
                  fontWeight: location.pathname === yourPagesItem.path ? 600 : 400
                }
              }}
            />
            {pagesWithoutRoute.length > 0 && (expandedSections[yourPagesItem.id] ? <ExpandLess /> : <ExpandMore />)}
          </ListItemButton>

          {/* Pages without specific routes */}
          {pagesWithoutRoute.length > 0 && (
            <Collapse in={expandedSections[yourPagesItem.id]} timeout="auto" unmountOnExit>
              <List component="div" disablePadding sx={{ pl: 2 }}>
                {[...pagesWithoutRoute]
                  .sort((a, b) => (a.navigation_order || 0) - (b.navigation_order || 0))
                  .map(page => {
                  const pagePath = `${basePath}/${page.route}`;
                  const isChildActive = location.pathname === pagePath;

                  return (
                    <ListItem
                      key={page.id}
                      component={Link}
                      to={pagePath}
                      selected={isChildActive}
                      sx={{
                        color: 'text.primary',
                        '&.Mui-selected': {
                          bgcolor: 'action.selected',
                          color: 'primary.main'
                        },
                        '&:hover': {
                          bgcolor: 'action.hover'
                        }
                      }}
                    >
                      <ListItemIcon sx={{ minWidth: '32px' }}>
                        {page.icon ? (
                          <IconResolver icon={page.icon} />
                        ) : (
                          <PageIcon />
                        )}
                      </ListItemIcon>
                      <ListItemText primary={page.name} />
                    </ListItem>
                  );
                })}
              </List>
            </Collapse>
          )}
        </React.Fragment>
      )}

      {/* Root level pages - filtered to exclude pages with parent routes and specific names */}
      {finalRootPages.length > 0 && renderNavigationItems({ ...pageHierarchy, root: finalRootPages }, basePath, location.pathname, 'root')}
    </List>
  );
};

// Helper function to render navigation items based on the page hierarchy
function renderNavigationItems(hierarchy: PageHierarchy, basePath: string, currentPath: string, section: string = 'root') {
  // Sort pages by navigation_order
  const sortedPages = [...hierarchy[section]]
    .filter(page => page.display_in_navigation !== false)
    .sort((a, b) => (a.navigation_order || 0) - (b.navigation_order || 0));

  return sortedPages.map((page: any) => {
    const pagePath = `${basePath}/${page.route}`;
    const isActive = currentPath === pagePath;
    const hasChildren = hierarchy[page.route || '']?.length > 0;

    if (page.is_parent_page && hasChildren) {
      return (
        <NestedNavItem
          key={page.id}
          page={page}
          childPages={hierarchy[page.route || '']}
          basePath={basePath}
          currentPath={currentPath}
        />
      );
    } else {
      return (
        <ListItem
          key={page.id}
          component={Link}
          to={pagePath}
          selected={isActive}
          sx={{
            color: 'text.primary',
            '&.Mui-selected': {
              bgcolor: 'action.selected',
              color: 'primary.main'
            },
            '&:hover': {
              bgcolor: 'action.hover'
            }
          }}
        >
          <ListItemIcon sx={{ minWidth: '32px' }}>
            {page.icon ? (
              <IconResolver icon={page.icon} />
            ) : (
              <PageIcon />
            )}
          </ListItemIcon>
          <ListItemText primary={page.name} />
        </ListItem>
      );
    }
  });
}

// Component for nested navigation items
interface NestedNavItemProps {
  page: any;
  childPages: any[];
  basePath: string;
  currentPath: string;
}

function NestedNavItem({ page, childPages, basePath, currentPath }: NestedNavItemProps) {
  const pagePath = `${basePath}/${page.route}`;
  const isActive = currentPath === pagePath;
  const isChildActive = currentPath.startsWith(pagePath + '/');

  // Open by default if current page is this item or one of its children
  const [open, setOpen] = useState(isActive || isChildActive);

  // Sort child pages by navigation_order
  const sortedChildPages = [...childPages]
    .filter(childPage => childPage.display_in_navigation !== false)
    .sort((a, b) => (a.navigation_order || 0) - (b.navigation_order || 0));

  return (
    <>
      <ListItem
        button
        onClick={() => setOpen(!open)}
        selected={isActive}
        sx={{
          color: 'text.primary',
          '&.Mui-selected': {
            bgcolor: 'action.selected',
            color: 'primary.main'
          },
          '&:hover': {
            bgcolor: 'action.hover'
          }
        }}
      >
        <ListItemIcon sx={{ minWidth: '32px' }}>
          {page.icon ? (
            <IconResolver icon={page.icon} />
          ) : (
            <FolderIcon />
          )}
        </ListItemIcon>
        <ListItemText primary={page.name} />
        {open ? <ExpandLess /> : <ExpandMore />}
      </ListItem>
      <Collapse in={open} timeout="auto" unmountOnExit>
        <List component="div" disablePadding>
          {/* Link to parent page itself */}
          <ListItem
            button
            component={Link}
            to={pagePath}
            selected={isActive}
            sx={{
              pl: 4,
              color: 'text.primary',
              '&.Mui-selected': {
                bgcolor: 'action.selected',
                color: 'primary.main'
              },
              '&:hover': {
                bgcolor: 'action.hover'
              }
            }}
          >
            <ListItemText primary="Overview" />
          </ListItem>

          {/* Links to child pages */}
          {sortedChildPages.map(childPage => {
            const childPath = `${basePath}/${childPage.route}`;
            const isChildActive = currentPath === childPath;

            return (
              <ListItem
                key={childPage.id}
                button
                component={Link}
                to={childPath}
                selected={isChildActive}
                sx={{
                  pl: 4,
                  color: 'text.primary',
                  '&.Mui-selected': {
                    bgcolor: 'action.selected',
                    color: 'primary.main'
                  },
                  '&:hover': {
                    bgcolor: 'action.hover'
                  }
                }}
              >
                <ListItemIcon sx={{ minWidth: 36 }}>
                  {childPage.icon ? (
                    <IconResolver icon={childPage.icon} />
                  ) : (
                    <PageIcon fontSize="small" />
                  )}
                </ListItemIcon>
                <ListItemText primary={childPage.name} />
              </ListItem>
            );
          })}
        </List>
      </Collapse>
    </>
  );
}
