import React, { useState } from 'react';
import { Box, Select, MenuItem, FormControl, Stack, IconButton, Tooltip, Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField } from '@mui/material';
import SmartphoneIcon from '@mui/icons-material/Smartphone';
import TabletIcon from '@mui/icons-material/Tablet';
import DesktopWindowsIcon from '@mui/icons-material/DesktopWindows';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import SaveIcon from '@mui/icons-material/Save';
import { Page } from '../pages';
import { RenamePageDialog } from './RenamePageDialog';

interface PageSelectorProps {
  pages: Page[];
  currentPage: Page;
  onPageChange: (page: Page) => void;
  onCreatePage: (pageName: string) => void;
  onDeletePage: (pageId: string) => void;
  onRenamePage: (pageId: string, newName: string) => void;
  onSavePage?: (pageId: string) => void;
}

interface CreatePageDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (pageName: string) => void;
}

const CreatePageDialog: React.FC<CreatePageDialogProps> = ({ open, onClose, onConfirm }) => {
  const [pageName, setPageName] = useState('');

  const handleConfirm = () => {
    if (pageName.trim()) {
      onConfirm(pageName.trim());
      setPageName('');
      onClose();
    }
  };

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>Create New Page</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          margin="dense"
          label="Page Name"
          fullWidth
          value={pageName}
          onChange={(e) => setPageName(e.target.value)}
          onKeyPress={(e) => {
            if (e.key === 'Enter') {
              handleConfirm();
            }
          }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={handleConfirm} variant="contained" disabled={!pageName.trim()}>
          Create
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export const PageSelector: React.FC<PageSelectorProps> = ({
  pages,
  currentPage,
  onPageChange,
  onCreatePage,
  onDeletePage,
  onRenamePage,
  onSavePage,
}) => {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);

  const getLayoutIndicators = (page: Page) => {
    // Check if layouts exist and have content
    const hasTabletLayout = page.layouts?.tablet && page.layouts.tablet.length > 0;
    const hasMobileLayout = page.layouts?.mobile && page.layouts.mobile.length > 0;

    return (
      <Stack direction="row" spacing={0.5} sx={{ ml: 1 }}>
        <DesktopWindowsIcon
          fontSize="small"
          sx={{ color: 'success.main' }}
          titleAccess="Desktop Layout (Required)"
        />
        <TabletIcon
          fontSize="small"
          sx={{ 
            color: hasTabletLayout ? 'success.main' : 'text.disabled',
            opacity: hasTabletLayout ? 1 : 0.5
          }}
          titleAccess={hasTabletLayout ? "Tablet Layout Available" : "Using Desktop Layout"}
        />
        <SmartphoneIcon
          fontSize="small"
          sx={{ 
            color: hasMobileLayout ? 'success.main' : 'text.disabled',
            opacity: hasMobileLayout ? 1 : 0.5
          }}
          titleAccess={hasMobileLayout ? "Mobile Layout Available" : "Using Desktop Layout"}
        />
      </Stack>
    );
  };

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Tooltip title="Create New Page">
          <IconButton 
            onClick={() => setCreateDialogOpen(true)}
            size="small"
            sx={{ color: 'primary.main' }}
          >
            <AddIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="Save Current Page">
          <IconButton 
            onClick={() => onSavePage && onSavePage(currentPage.id)}
            size="small"
            sx={{ color: 'success.main' }}
            disabled={!onSavePage}
          >
            <SaveIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="Rename Current Page">
          <IconButton 
            onClick={() => setRenameDialogOpen(true)}
            size="small"
            sx={{ color: 'primary.main' }}
          >
            <EditIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="Delete Current Page">
          <IconButton 
            onClick={() => onDeletePage(currentPage.id)}
            size="small"
            sx={{ color: 'error.main' }}
            disabled={pages.length <= 1}
          >
            <DeleteIcon />
          </IconButton>
        </Tooltip>
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <Select
            value={currentPage.id}
            onChange={(e) => {
              const selectedPage = pages.find(p => p.id === e.target.value);
              if (selectedPage) {
                onPageChange(selectedPage);
              }
            }}
          >
            {pages.map((page) => (
              <MenuItem key={page.id} value={page.id}>
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                  {page.name}
                  {getLayoutIndicators(page)}
                </Box>
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>

      <CreatePageDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        onConfirm={onCreatePage}
      />
      <RenamePageDialog
        open={renameDialogOpen}
        currentName={currentPage.name}
        onClose={() => setRenameDialogOpen(false)}
        onConfirm={(newName) => {
          onRenamePage(currentPage.id, newName);
          setRenameDialogOpen(false);
        }}
      />
    </>
  );
};
