import React, { useState } from 'react';
import {
  Box,
  Button,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Typography,
  IconButton,
  Tooltip,
  FormControl,
  Select,
  Divider
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import SaveIcon from '@mui/icons-material/Save';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { Page } from '../../types';

interface PageSelectorProps {
  pages: Page[];
  currentPage: Page | null;
  onPageChange: (page: Page) => void;
  onCreatePage: (pageName: string) => Promise<Page | null>;
  onDeletePage: (pageId: string) => Promise<void>;
  onRenamePage: (pageId: string, newName: string) => Promise<void>;
  onSavePage?: (pageId: string) => Promise<Page | null>;
}

/**
 * Component for selecting, creating, renaming, and deleting pages
 * @param props The component props
 * @returns The page selector component
 */
export const PageSelector: React.FC<PageSelectorProps> = ({
  pages,
  currentPage,
  onPageChange,
  onCreatePage,
  onDeletePage,
  onRenamePage,
  onSavePage
}) => {
  // Menu state
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);
  
  // Dialog states
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  
  // Form states
  const [newPageName, setNewPageName] = useState('');
  const [newPageNameError, setNewPageNameError] = useState<string | null>(null);
  
  /**
   * Open the page menu
   * @param event The click event
   */
  const handleMenuOpen = (event: React.MouseEvent<HTMLButtonElement>) => {
    setAnchorEl(event.currentTarget);
  };
  
  /**
   * Close the page menu
   */
  const handleMenuClose = () => {
    setAnchorEl(null);
  };
  
  /**
   * Handle page selection
   * @param page The selected page
   */
  const handlePageSelect = (page: Page) => {
    onPageChange(page);
    handleMenuClose();
  };
  
  /**
   * Open the create page dialog
   */
  const handleCreateDialogOpen = () => {
    setNewPageName('');
    setNewPageNameError(null);
    setCreateDialogOpen(true);
    handleMenuClose();
  };
  
  /**
   * Close the create page dialog
   */
  const handleCreateDialogClose = () => {
    setCreateDialogOpen(false);
  };
  
  /**
   * Create a new page
   */
  const handleCreatePage = async () => {
    if (!newPageName.trim()) {
      setNewPageNameError('Page name is required');
      return;
    }
    
    try {
      const page = await onCreatePage(newPageName);
      if (page) {
        handleCreateDialogClose();
      }
    } catch (error) {
      console.error('Error creating page:', error);
      setNewPageNameError('Failed to create page');
    }
  };
  
  /**
   * Open the rename page dialog
   */
  const handleRenameDialogOpen = () => {
    if (!currentPage) return;
    
    setNewPageName(currentPage.name);
    setNewPageNameError(null);
    setRenameDialogOpen(true);
    handleMenuClose();
  };
  
  /**
   * Close the rename page dialog
   */
  const handleRenameDialogClose = () => {
    setRenameDialogOpen(false);
  };
  
  /**
   * Rename the current page
   */
  const handleRenamePage = async () => {
    if (!currentPage) return;
    
    if (!newPageName.trim()) {
      setNewPageNameError('Page name is required');
      return;
    }
    
    try {
      await onRenamePage(currentPage.id, newPageName);
      handleRenameDialogClose();
      
      // Refresh the page hierarchy to update the sidebar
      if (window.refreshPages) {
        // @ts-ignore
        window.refreshPages();
      }
      
      // Also refresh the sidebar using the global function if available
      if (window.refreshSidebar) {
        // @ts-ignore
        window.refreshSidebar();
      }
    } catch (error) {
      console.error('Error renaming page:', error);
      setNewPageNameError('Failed to rename page');
    }
  };
  
  /**
   * Open the delete page dialog
   */
  const handleDeleteDialogOpen = () => {
    setDeleteDialogOpen(true);
    handleMenuClose();
  };
  
  /**
   * Close the delete page dialog
   */
  const handleDeleteDialogClose = () => {
    setDeleteDialogOpen(false);
  };
  
  /**
   * Delete the current page
   */
  const handleDeletePage = async () => {
    if (!currentPage) return;
    
    try {
      await onDeletePage(currentPage.id);
      handleDeleteDialogClose();
      
      // Refresh the page hierarchy to update the sidebar
      if (window.refreshPages) {
        // @ts-ignore
        window.refreshPages();
      }
      
      // Also refresh the sidebar using the global function if available
      if (window.refreshSidebar) {
        // @ts-ignore
        window.refreshSidebar();
      }
    } catch (error) {
      console.error('Error deleting page:', error);
    }
  };
  
  /**
   * Save the current page
   */
  const handleSavePage = async () => {
    if (!currentPage || !onSavePage) return;
    
    try {
      await onSavePage(currentPage.id);
      handleMenuClose();
    } catch (error) {
      console.error('Error saving page:', error);
    }
  };
  
  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        {/* Create Page Button */}
        <Tooltip title="Create New Page">
          <IconButton 
            onClick={handleCreateDialogOpen}
            size="small"
            sx={{ color: 'primary.main' }}
          >
            <AddIcon />
          </IconButton>
        </Tooltip>
        
        {/* Page Selector Dropdown */}
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <Select
            value={currentPage?.id || ''}
            onChange={(e) => {
              const selectedPage = pages.find(p => p.id === e.target.value);
              if (selectedPage) {
                onPageChange(selectedPage);
              }
            }}
            displayEmpty
            renderValue={() => (
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                {currentPage?.name || 'Select Page'}
              </Box>
            )}
          >
            {pages.map((page) => (
              <MenuItem key={page.id} value={page.id}>
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                  {page.name}
                </Box>
              </MenuItem>
            ))}
            
 
            
 
          </Select>
        </FormControl>
        
        {/* Direct buttons for rename and delete removed as they're now in the GridToolbar */}
        <span style={{ display: 'none' }}>
          <IconButton
            size="small"
            color="primary"
            onClick={handleRenameDialogOpen}
            data-rename-page="true"
          >
            <EditIcon />
          </IconButton>
          <IconButton
            size="small"
            color="error"
            onClick={handleDeleteDialogOpen}
            data-delete-page="true"
          >
            <DeleteIcon />
          </IconButton>
        </span>
      </Box>
      
      {/* Create Page Dialog */}
      <Dialog open={createDialogOpen} onClose={handleCreateDialogClose}>
        <DialogTitle>Create New Page</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="Page Name"
            fullWidth
            value={newPageName}
            onChange={(e) => setNewPageName(e.target.value)}
            error={!!newPageNameError}
            helperText={newPageNameError}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCreateDialogClose}>Cancel</Button>
          <Button onClick={handleCreatePage} color="primary">Create</Button>
        </DialogActions>
      </Dialog>
      
      {/* Rename Page Dialog */}
      <Dialog open={renameDialogOpen} onClose={handleRenameDialogClose}>
        <DialogTitle>Rename Page</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="Page Name"
            fullWidth
            value={newPageName}
            onChange={(e) => setNewPageName(e.target.value)}
            error={!!newPageNameError}
            helperText={newPageNameError}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleRenameDialogClose}>Cancel</Button>
          <Button onClick={handleRenamePage} color="primary">Rename</Button>
        </DialogActions>
      </Dialog>
      
      {/* Delete Page Dialog */}
      <Dialog open={deleteDialogOpen} onClose={handleDeleteDialogClose}>
        <DialogTitle>Delete Page</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete the page "{currentPage?.name}"?
            This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleDeleteDialogClose}>Cancel</Button>
          <Button onClick={handleDeletePage} color="error">Delete</Button>
        </DialogActions>
      </Dialog>
    </>
  );
};