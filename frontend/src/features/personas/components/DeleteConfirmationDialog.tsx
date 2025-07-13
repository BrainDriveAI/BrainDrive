import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  Alert
} from '@mui/material';
import { Warning as WarningIcon } from '@mui/icons-material';
import { Persona } from '../types';

interface DeleteConfirmationDialogProps {
  open: boolean;
  persona: Persona | null;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

/**
 * Confirmation dialog for deleting a persona
 */
export const DeleteConfirmationDialog: React.FC<DeleteConfirmationDialogProps> = ({
  open,
  persona,
  onConfirm,
  onCancel,
  loading = false
}) => {
  if (!persona) {
    return null;
  }

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: { borderRadius: 2 }
      }}
    >
      <DialogTitle sx={{ pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <WarningIcon color="warning" />
          <Typography variant="h6" component="span">
            Delete Persona
          </Typography>
        </Box>
      </DialogTitle>
      
      <DialogContent>
        <Alert severity="warning" sx={{ mb: 2 }}>
          This action cannot be undone.
        </Alert>
        
        <Typography variant="body1" gutterBottom>
          Are you sure you want to delete the persona <strong>"{persona.name}"</strong>?
        </Typography>
        
        {persona.description && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {persona.description}
          </Typography>
        )}
        
        <Box sx={{ mt: 2, p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
          <Typography variant="body2" color="text.secondary">
            <strong>Created:</strong> {new Date(persona.created_at).toLocaleDateString()}
          </Typography>
          {persona.tags && persona.tags.length > 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              <strong>Tags:</strong> {persona.tags.join(', ')}
            </Typography>
          )}
        </Box>
      </DialogContent>
      
      <DialogActions sx={{ px: 3, pb: 3 }}>
        <Button
          onClick={onCancel}
          disabled={loading}
          variant="outlined"
        >
          Cancel
        </Button>
        <Button
          onClick={onConfirm}
          disabled={loading}
          variant="contained"
          color="error"
          sx={{ minWidth: 100 }}
        >
          {loading ? 'Deleting...' : 'Delete'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default DeleteConfirmationDialog;