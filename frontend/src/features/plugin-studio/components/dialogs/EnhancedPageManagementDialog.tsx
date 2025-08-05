import React, { useState, useCallback, useMemo } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  TextField,
  Alert,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
  Chip,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Switch,
  FormControlLabel,
  Divider,
  Card,
  CardContent,
  CardActions,
  Grid,
  Tooltip,
} from '@mui/material';
import {
  Edit as EditIcon,
  Delete as DeleteIcon,
  Add as AddIcon,
  FileCopy as DuplicateIcon,
  Visibility as PreviewIcon,
  Public as PublishIcon,
  PublicOff as UnpublishIcon,
  Search as SearchIcon,
  FilterList as FilterIcon,
} from '@mui/icons-material';
import { useEnhancedStudioState } from '../../hooks/useEnhancedStudioState';

interface PageData {
  id: string;
  name: string;
  route: string;
  isPublished: boolean;
  lastModified: string;
  createdAt: string;
  layouts: {
    desktop: any[];
    tablet: any[];
    mobile: any[];
  };
  modules: any[];
  metadata: {
    title?: string;
    description?: string;
    keywords?: string[];
    author?: string;
  };
}

interface EnhancedPageManagementDialogProps {
  open: boolean;
  onClose: () => void;
  pages: PageData[];
  currentPageId?: string;
  onPageSelect: (pageId: string) => void;
  onPageCreate: (pageData: Partial<PageData>) => void;
  onPageUpdate: (pageId: string, pageData: Partial<PageData>) => void;
  onPageDelete: (pageId: string) => void;
  onPageDuplicate: (pageId: string) => void;
  onPagePublish: (pageId: string, published: boolean) => void;
}

type SortField = 'name' | 'route' | 'lastModified' | 'createdAt';
type SortOrder = 'asc' | 'desc';

export const EnhancedPageManagementDialog: React.FC<EnhancedPageManagementDialogProps> = ({
  open,
  onClose,
  pages,
  currentPageId,
  onPageSelect,
  onPageCreate,
  onPageUpdate,
  onPageDelete,
  onPageDuplicate,
  onPagePublish,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState<SortField>('lastModified');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [filterPublished, setFilterPublished] = useState<'all' | 'published' | 'unpublished'>('all');
  const [editingPage, setEditingPage] = useState<string | null>(null);
  const [newPageData, setNewPageData] = useState<Partial<PageData>>({
    name: '',
    route: '',
    isPublished: false,
    metadata: {
      title: '',
      description: '',
      keywords: [],
    },
  });
  const [showCreateForm, setShowCreateForm] = useState(false);

  // Filter and sort pages
  const filteredAndSortedPages = useMemo(() => {
    if (!pages || !Array.isArray(pages)) return [];
    
    let filtered = (pages || []).filter(page => {
      const matchesSearch = !searchTerm || 
        page.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        page.route.toLowerCase().includes(searchTerm.toLowerCase()) ||
        page.metadata.title?.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesFilter = filterPublished === 'all' ||
        (filterPublished === 'published' && page.isPublished) ||
        (filterPublished === 'unpublished' && !page.isPublished);
      
      return matchesSearch && matchesFilter;
    });

    filtered.sort((a, b) => {
      let aValue: any = a[sortField];
      let bValue: any = b[sortField];
      
      if (sortField === 'lastModified' || sortField === 'createdAt') {
        aValue = new Date(aValue).getTime();
        bValue = new Date(bValue).getTime();
      } else {
        aValue = aValue?.toString().toLowerCase() || '';
        bValue = bValue?.toString().toLowerCase() || '';
      }
      
      if (sortOrder === 'asc') {
        return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
      } else {
        return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;
      }
    });

    return filtered;
  }, [pages, searchTerm, sortField, sortOrder, filterPublished]);

  // Handle page creation
  const handleCreatePage = useCallback(() => {
    if (!newPageData.name || !newPageData.route) return;
    
    const pageData: Partial<PageData> = {
      ...newPageData,
      id: `page-${Date.now()}`,
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      layouts: {
        desktop: [],
        tablet: [],
        mobile: [],
      },
      modules: [],
    };
    
    onPageCreate(pageData);
    setNewPageData({
      name: '',
      route: '',
      isPublished: false,
      metadata: {
        title: '',
        description: '',
        keywords: [],
      },
    });
    setShowCreateForm(false);
  }, [newPageData, onPageCreate]);

  // Handle page update
  const handleUpdatePage = useCallback((pageId: string, updates: Partial<PageData>) => {
    onPageUpdate(pageId, {
      ...updates,
      lastModified: new Date().toISOString(),
    });
    setEditingPage(null);
  }, [onPageUpdate]);

  // Handle route generation from name
  const handleNameChange = useCallback((name: string) => {
    const route = '/' + name.toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();
    
    setNewPageData(prev => ({
      ...prev,
      name,
      route,
      metadata: {
        ...prev.metadata,
        title: name,
      },
    }));
  }, []);

  // Format date for display
  const formatDate = useCallback((dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }, []);

  // Get page statistics
  const pageStats = useMemo(() => {
    if (!pages || !Array.isArray(pages)) return { total: 0, published: 0, unpublished: 0 };
    
    const total = (pages || []).length;
    const published = (pages || []).filter(p => p.isPublished).length;
    const unpublished = total - published;
    
    return { total, published, unpublished };
  }, [pages]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      PaperProps={{
        sx: { height: '80vh', display: 'flex', flexDirection: 'column' }
      }}
    >
      <DialogTitle>
        <Box display="flex" alignItems="center" justifyContent="space-between">
          <Typography variant="h6">Page Management</Typography>
          <Box display="flex" alignItems="center" gap={2}>
            <Typography variant="body2" color="text.secondary">
              {pageStats.total} pages ({pageStats.published} published)
            </Typography>
            <Button
              startIcon={<AddIcon />}
              variant="contained"
              onClick={() => setShowCreateForm(true)}
            >
              New Page
            </Button>
          </Box>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ flex: 1, display: 'flex', flexDirection: 'column', p: 2 }}>
        {/* Search and Filter Controls */}
        <Box sx={{ mb: 3 }}>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                placeholder="Search pages..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                InputProps={{
                  startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} />,
                }}
              />
            </Grid>
            <Grid item xs={6} md={2}>
              <FormControl fullWidth>
                <InputLabel>Sort by</InputLabel>
                <Select
                  value={sortField}
                  onChange={(e) => setSortField(e.target.value as SortField)}
                  label="Sort by"
                >
                  <MenuItem value="name">Name</MenuItem>
                  <MenuItem value="route">Route</MenuItem>
                  <MenuItem value="lastModified">Modified</MenuItem>
                  <MenuItem value="createdAt">Created</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={6} md={2}>
              <FormControl fullWidth>
                <InputLabel>Order</InputLabel>
                <Select
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value as SortOrder)}
                  label="Order"
                >
                  <MenuItem value="asc">Ascending</MenuItem>
                  <MenuItem value="desc">Descending</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={4}>
              <FormControl fullWidth>
                <InputLabel>Filter</InputLabel>
                <Select
                  value={filterPublished}
                  onChange={(e) => setFilterPublished(e.target.value as any)}
                  label="Filter"
                >
                  <MenuItem value="all">All Pages</MenuItem>
                  <MenuItem value="published">Published Only</MenuItem>
                  <MenuItem value="unpublished">Unpublished Only</MenuItem>
                </Select>
              </FormControl>
            </Grid>
          </Grid>
        </Box>

        {/* Create New Page Form */}
        {showCreateForm && (
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>Create New Page</Typography>
              <Grid container spacing={2}>
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    label="Page Name"
                    value={newPageData.name}
                    onChange={(e) => handleNameChange(e.target.value)}
                    required
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    label="Route"
                    value={newPageData.route}
                    onChange={(e) => setNewPageData(prev => ({ ...prev, route: e.target.value }))}
                    required
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    label="Page Title"
                    value={newPageData.metadata?.title || ''}
                    onChange={(e) => setNewPageData(prev => ({
                      ...prev,
                      metadata: { ...prev.metadata, title: e.target.value }
                    }))}
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={newPageData.isPublished || false}
                        onChange={(e) => setNewPageData(prev => ({ ...prev, isPublished: e.target.checked }))}
                      />
                    }
                    label="Publish immediately"
                  />
                </Grid>
                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    label="Description"
                    multiline
                    rows={2}
                    value={newPageData.metadata?.description || ''}
                    onChange={(e) => setNewPageData(prev => ({
                      ...prev,
                      metadata: { ...prev.metadata, description: e.target.value }
                    }))}
                  />
                </Grid>
              </Grid>
            </CardContent>
            <CardActions>
              <Button onClick={() => setShowCreateForm(false)}>Cancel</Button>
              <Button
                variant="contained"
                onClick={handleCreatePage}
                disabled={!newPageData.name || !newPageData.route}
              >
                Create Page
              </Button>
            </CardActions>
          </Card>
        )}

        {/* Pages List */}
        <Box sx={{ flex: 1, overflow: 'auto' }}>
          {filteredAndSortedPages.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <Typography color="text.secondary">
                {searchTerm ? 'No pages match your search criteria' : 'No pages found'}
              </Typography>
            </Box>
          ) : (
            <List>
              {filteredAndSortedPages.map((page) => (
                <ListItem
                  key={page.id}
                  sx={{
                    border: 1,
                    borderColor: 'divider',
                    borderRadius: 1,
                    mb: 1,
                    bgcolor: currentPageId === page.id ? 'action.selected' : 'background.paper',
                  }}
                >
                  <ListItemText
                    primary={
                      <Box display="flex" alignItems="center" gap={1}>
                        <Typography variant="subtitle1">{page.name}</Typography>
                        {page.isPublished && (
                          <Chip label="Published" size="small" color="success" />
                        )}
                        {currentPageId === page.id && (
                          <Chip label="Current" size="small" color="primary" />
                        )}
                      </Box>
                    }
                    secondary={
                      <Box>
                        <Typography variant="body2" color="text.secondary">
                          Route: {page.route}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          Modified: {formatDate(page.lastModified)} | 
                          Created: {formatDate(page.createdAt)} |
                          Modules: {page.modules.length}
                        </Typography>
                      </Box>
                    }
                  />
                  <ListItemSecondaryAction>
                    <Box display="flex" gap={0.5}>
                      <Tooltip title="Select page">
                        <IconButton
                          onClick={() => onPageSelect(page.id)}
                          disabled={currentPageId === page.id}
                        >
                          <EditIcon />
                        </IconButton>
                      </Tooltip>
                      
                      <Tooltip title="Duplicate page">
                        <IconButton onClick={() => onPageDuplicate(page.id)}>
                          <DuplicateIcon />
                        </IconButton>
                      </Tooltip>
                      
                      <Tooltip title={page.isPublished ? 'Unpublish' : 'Publish'}>
                        <IconButton
                          onClick={() => onPagePublish(page.id, !page.isPublished)}
                          color={page.isPublished ? 'success' : 'default'}
                        >
                          {page.isPublished ? <UnpublishIcon /> : <PublishIcon />}
                        </IconButton>
                      </Tooltip>
                      
                      <Tooltip title="Delete page">
                        <IconButton
                          onClick={() => onPageDelete(page.id)}
                          color="error"
                          disabled={currentPageId === page.id}
                        >
                          <DeleteIcon />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  </ListItemSecondaryAction>
                </ListItem>
              ))}
            </List>
          )}
        </Box>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
};

export default EnhancedPageManagementDialog;