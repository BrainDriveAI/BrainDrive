import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField
} from '@mui/material';

interface RenamePageDialogProps {
  open: boolean;
  currentName: string;
  onClose: () => void;
  onConfirm: (newName: string) => void;
}

export const RenamePageDialog: React.FC<RenamePageDialogProps> = ({
  open,
  currentName,
  onClose,
  onConfirm
}) => {
  const [pageName, setPageName] = useState(currentName);
  const [error, setError] = useState('');

  // Update pageName when currentName changes
  useEffect(() => {
    setPageName(currentName);
  }, [currentName]);

  const handleConfirm = () => {
    if (!pageName.trim()) {
      setError('Page name is required');
      return;
    }
    onConfirm(pageName);
    setError('');
  };

  const handleClose = () => {
    setPageName(currentName);
    setError('');
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Rename Page</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          margin="dense"
          label="Page Name"
          fullWidth
          value={pageName}
          onChange={(e) => {
            setPageName(e.target.value);
            setError('');
          }}
          error={!!error}
          helperText={error}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Cancel</Button>
        <Button onClick={handleConfirm} variant="contained" color="primary">
          Rename
        </Button>
      </DialogActions>
    </Dialog>
  );
};
