import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  IconButton,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  ListItemSecondaryAction,
  TextField,
  Switch,
  FormControlLabel,
  Divider,
  Tooltip,
  Chip,
  Alert
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import PublishIcon from '@mui/icons-material/Publish';
import UnpublishedIcon from '@mui/icons-material/Unpublished';
import SaveIcon from '@mui/icons-material/Save';
import RestoreIcon from '@mui/icons-material/Restore';
import AddIcon from '@mui/icons-material/Add';
import { usePluginStudio } from '../../hooks';

interface PageManagementDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Dialog for managing pages (create, rename, delete, publish, etc.)
 * @param props The component props
 * @returns The page management dialog component
 */
export const PageManagementDialog: React.FC<PageManagementDialogProps> = ({ open, onClose }) => {
  const { 
    pages, 
    currentPage, 
    setCurrentPage, 
    createPage, 
    deletePage, 
    renamePage, 
    savePage, 
    publishPage, 
    backupPage, 
    restorePage 
  } = usePluginStudio();
  
  const [newPageName, setNewPageName] = useState('');
  const [editingPageId, setEditingPageId] = useState<string | null>(null);
  const [editingPageName, setEditingPageName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [autoSaving, setAutoSaving] = useState<string | null>(null); // Track which page is being auto-saved
  
  // Reset state when dialog opens
  React.useEffect(() => {
    if (open) {
      setNewPageName('');
      setEditingPageId(null);
      setEditingPageName('');
      setError(null);
      setAutoSaving(null);
    }
  }, [open]);
  
  // Handle creating a new page
  const handleCreatePage = async () => {
    if (!newPageName.trim()) {
      setError('Page name cannot be empty');
      return;
    }
    
    try {
      await createPage(newPageName);
      setNewPageName('');
      setError(null);
    } catch (err) {
      setError('Failed to create page');
      console.error(err);
    }
  };
  
  // Handle starting to edit a page name
  const handleStartEdit = (page: any) => {
    setEditingPageId(page.id);
    setEditingPageName(page.name);
  };
  
  // Handle saving a page name edit
  const handleSaveEdit = async () => {
    if (!editingPageId || !editingPageName.trim()) {
      setError('Page name cannot be empty');
      return;
    }
    
    try {
      await renamePage(editingPageId, editingPageName);
      setEditingPageId(null);
      setEditingPageName('');
      setError(null);
    } catch (err) {
      setError('Failed to rename page');
      console.error(err);
    }
  };
  
  // Handle canceling a page name edit
  const handleCancelEdit = () => {
    setEditingPageId(null);
    setEditingPageName('');
  };
  
  // Handle deleting a page
  const handleDeletePage = async (pageId: string) => {
    if (pages.length <= 1) {
      setError('Cannot delete the last page');
      return;
    }
    
    try {
      await deletePage(pageId);
      setError(null);
    } catch (err) {
      setError('Failed to delete page');
      console.error(err);
    }
  };
  
  // Handle publishing/unpublishing a page
  const handlePublishPage = async (pageId: string, publish: boolean) => {
    console.log('🚀 handlePublishPage called:', { pageId, publish, currentPageId: currentPage?.id });
    
    try {
      setError(null);
      
      // Auto-save if publishing the current page (always save to ensure latest changes are published)
      if (publish && currentPage && pageId === currentPage.id) {
        console.log('🔄 Auto-saving page before publishing...', { pageId, currentPageId: currentPage.id });
        setAutoSaving(pageId);
        
        try {
          console.log('💾 Calling savePage...');
          await savePage(pageId);
          console.log('✅ Auto-save completed successfully');
        } catch (saveErr) {
          console.error('❌ Auto-save failed:', saveErr);
          setAutoSaving(null);
          setError('Failed to auto-save page before publishing. Please save manually first.');
          return; // Don't proceed with publishing if auto-save fails
        }
        
        setAutoSaving(null);
      } else {
        console.log('⏭️ Skipping auto-save:', { publish, hasCurrentPage: !!currentPage, isCurrentPage: pageId === currentPage?.id });
      }
      
      // Proceed with publish/unpublish
      console.log('📤 Calling publishPage...');
      await publishPage(pageId, publish);
      console.log('✅ Publish completed successfully');
    } catch (err) {
      console.error('❌ Publish failed:', err);
      setAutoSaving(null);
      setError(`Failed to ${publish ? 'publish' : 'unpublish'} page`);
    }
  };
  
  // Handle backing up a page
  const handleBackupPage = async (pageId: string) => {
    try {
      await backupPage(pageId);
      setError(null);
    } catch (err) {
      setError('Failed to backup page');
      console.error(err);
    }
  };
  
  // Handle restoring a page from backup
  const handleRestorePage = async (pageId: string) => {
    try {
      await restorePage(pageId);
      setError(null);
    } catch (err) {
      setError('Failed to restore page');
      console.error(err);
    }
  };
  
  // Handle saving a local page
  const handleSavePage = async (pageId: string) => {
    try {
      await savePage(pageId);
      setError(null);
    } catch (err) {
      setError('Failed to save page');
      console.error(err);
    }
  };
  
  // Format date for display
  const formatDate = (dateString?: string) => {
    if (!dateString) return 'Never';
    
    const date = new Date(dateString);
    return date.toLocaleString();
  };
  
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column'
        }
      }}
    >
      <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h6">Manage Pages</Typography>
        <IconButton edge="end" color="inherit" onClick={onClose} aria-label="close">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      
      <DialogContent sx={{ flex: 1, overflow: 'auto' }}>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        
        {/* Create New Page */}
        <Box sx={{ mb: 3, display: 'flex', alignItems: 'flex-end', gap: 1 }}>
          <TextField
            label="New Page Name"
            value={newPageName}
            onChange={(e) => setNewPageName(e.target.value)}
            variant="outlined"
            size="small"
            fullWidth
          />
          <Button
            variant="contained"
            color="primary"
            startIcon={<AddIcon />}
            onClick={handleCreatePage}
            disabled={!newPageName.trim()}
          >
            Create
          </Button>
        </Box>
        
        <Divider sx={{ my: 2 }} />
        
        {/* Page List */}
        <Typography variant="subtitle1" gutterBottom>
          Your Pages 3
        </Typography>
        
        <List>
          {pages.map((page) => (
            <ListItem
              key={page.id}
              selected={currentPage?.id === page.id}
              onClick={() => setCurrentPage(page)}
              sx={{
                borderRadius: 1,
                mb: 1,
                border: 1,
                borderColor: 'divider',
                '&.Mui-selected': {
                  backgroundColor: 'action.selected',
                  '&:hover': {
                    backgroundColor: 'action.selected'
                  }
                }
              }}
            >
              <ListItemIcon>
                {page.is_local ? (
                  <Tooltip title="Local Page (Not Saved)">
                    <SaveIcon color="warning" />
                  </Tooltip>
                ) : page.is_published ? (
                  <Tooltip title="Published">
                    <PublishIcon color="success" />
                  </Tooltip>
                ) : (
                  <Tooltip title="Not Published">
                    <UnpublishedIcon color="action" />
                  </Tooltip>
                )}
              </ListItemIcon>
              
              <ListItemText
                primary={
                  editingPageId === page.id ? (
                    <TextField
                      value={editingPageName}
                      onChange={(e) => setEditingPageName(e.target.value)}
                      variant="outlined"
                      size="small"
                      fullWidth
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleSaveEdit();
                        } else if (e.key === 'Escape') {
                          handleCancelEdit();
                        }
                      }}
                    />
                  ) : (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      {page.name}
                      {autoSaving === page.id && (
                        <Chip size="small" label="Saving before publish..." color="info" />
                      )}
                      {page.is_local && (
                        <Chip size="small" label="Local" color="warning" />
                      )}
                      {page.is_published && (
                        <Chip size="small" label="Published" color="success" />
                      )}
                    </Box>
                  )
                }
                secondary={
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mt: 0.5 }}>
                    <Typography variant="caption" component="div">
                      Route: {page.route || 'None'}
                    </Typography>
                    <Typography variant="caption" component="div">
                      Last Updated: {formatDate((page as any).updated_at)}
                    </Typography>
                    {page.backup_date && (
                      <Typography variant="caption" component="div">
                        Backup: {formatDate(page.backup_date)}
                      </Typography>
                    )}
                  </Box>
                }
              />
              
              <ListItemSecondaryAction>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  {editingPageId === page.id ? (
                    <>
                      <Button size="small" onClick={handleSaveEdit}>Save</Button>
                      <Button size="small" onClick={handleCancelEdit}>Cancel</Button>
                    </>
                  ) : (
                    <>
                      {/* Edit Button */}
                      <Tooltip title="Rename">
                        <IconButton
                          edge="end"
                          aria-label="rename"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleStartEdit(page);
                          }}
                          size="small"
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      
                      {/* Local Page Save Button */}
                      {page.is_local && (
                        <Tooltip title="Save as New Page">
                          <IconButton
                            edge="end"
                            aria-label="save"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSavePage(page.id);
                            }}
                            size="small"
                            color="primary"
                          >
                            <SaveIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      
                      {/* Publish/Unpublish Button */}
                      {!page.is_local && (
                        <Tooltip title={
                          autoSaving === page.id
                            ? "Saving current changes before publish..."
                            : page.is_published ? "Unpublish" : "Publish"
                        }>
                          <span>
                            <IconButton
                              edge="end"
                              aria-label={page.is_published ? "unpublish" : "publish"}
                              onClick={(e) => {
                                e.stopPropagation();
                                handlePublishPage(page.id, !page.is_published);
                              }}
                              size="small"
                              color={page.is_published ? "success" : "primary"}
                              disabled={autoSaving === page.id}
                            >
                              {page.is_published ? (
                                <UnpublishedIcon fontSize="small" />
                              ) : (
                                <PublishIcon fontSize="small" />
                              )}
                            </IconButton>
                          </span>
                        </Tooltip>
                      )}
                      
                      {/* Backup Button */}
                      {!page.is_local && (
                        <Tooltip title="Create Backup">
                          <IconButton
                            edge="end"
                            aria-label="backup"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleBackupPage(page.id);
                            }}
                            size="small"
                          >
                            <SaveIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      
                      {/* Restore Button */}
                      {!page.is_local && page.backup_date && (
                        <Tooltip title="Restore from Backup">
                          <IconButton
                            edge="end"
                            aria-label="restore"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRestorePage(page.id);
                            }}
                            size="small"
                            color="warning"
                          >
                            <RestoreIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      
                      {/* Delete Button */}
                      <Tooltip title="Delete">
                        <IconButton
                          edge="end"
                          aria-label="delete"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeletePage(page.id);
                          }}
                          size="small"
                          color="error"
                          disabled={pages.length <= 1}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </>
                  )}
                </Box>
              </ListItemSecondaryAction>
            </ListItem>
          ))}
        </List>
        
        {pages.length === 0 && (
          <Typography color="text.secondary" align="center" sx={{ py: 4 }}>
            No pages found. Create a new page to get started.
          </Typography>
        )}
      </DialogContent>
      
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
};