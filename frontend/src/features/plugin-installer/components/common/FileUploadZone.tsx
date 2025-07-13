import React, { useCallback, useState, useRef } from 'react';
import {
  Box,
  Typography,
  Button,
  LinearProgress,
  Alert,
  Chip,
  IconButton,
  Paper
} from '@mui/material';
import {
  CloudUpload as CloudUploadIcon,
  InsertDriveFile as FileIcon,
  Clear as ClearIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon
} from '@mui/icons-material';
import { validateArchiveFile, formatFileSize } from '../../utils/fileValidation';
import { FileUploadState, ArchiveValidationResult } from '../../types';

interface FileUploadZoneProps {
  onFileSelect: (file: File) => void;
  onFileRemove: () => void;
  uploadState: FileUploadState;
  disabled?: boolean;
  accept?: string;
  maxSize?: number;
  className?: string;
}

const FileUploadZone: React.FC<FileUploadZoneProps> = ({
  onFileSelect,
  onFileRemove,
  uploadState,
  disabled = false,
  accept = '.zip,.rar,.tar.gz,.tgz',
  maxSize = 100 * 1024 * 1024, // 100MB
  className
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [validation, setValidation] = useState<ArchiveValidationResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) {
      setIsDragOver(true);
    }
  }, [disabled]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    if (disabled) return;

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handleFileSelection(files[0]);
    }
  }, [disabled]);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFileSelection(files[0]);
    }
  }, []);

  const handleFileSelection = useCallback((file: File) => {
    const validationResult = validateArchiveFile(file);
    setValidation(validationResult);

    if (validationResult.isValid) {
      onFileSelect(file);
    }
  }, [onFileSelect]);

  const handleBrowseClick = useCallback(() => {
    if (!disabled && fileInputRef.current) {
      fileInputRef.current.click();
    }
  }, [disabled]);

  const handleRemoveFile = useCallback(() => {
    setValidation(null);
    onFileRemove();
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [onFileRemove]);

  const getStatusIcon = () => {
    if (uploadState.error || (validation && !validation.isValid)) {
      return <ErrorIcon color="error" />;
    }
    if (uploadState.file && validation?.isValid) {
      return <CheckCircleIcon color="success" />;
    }
    return <CloudUploadIcon color="action" />;
  };

  const getStatusColor = () => {
    if (uploadState.error || (validation && !validation.isValid)) {
      return 'error.main';
    }
    if (uploadState.file && validation?.isValid) {
      return 'success.main';
    }
    if (isDragOver) {
      return 'primary.main';
    }
    return 'text.secondary';
  };

  const getBorderColor = () => {
    if (uploadState.error || (validation && !validation.isValid)) {
      return 'error.main';
    }
    if (uploadState.file && validation?.isValid) {
      return 'success.main';
    }
    if (isDragOver) {
      return 'primary.main';
    }
    return 'divider';
  };

  return (
    <Box className={className}>
      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        onChange={handleFileInputChange}
        style={{ display: 'none' }}
        disabled={disabled}
      />

      <Paper
        variant="outlined"
        sx={{
          p: 3,
          textAlign: 'center',
          borderStyle: 'dashed',
          borderWidth: 2,
          borderColor: getBorderColor(),
          backgroundColor: isDragOver ? 'action.hover' : 'background.paper',
          cursor: disabled ? 'not-allowed' : 'pointer',
          transition: 'all 0.2s ease-in-out',
          opacity: disabled ? 0.6 : 1,
          '&:hover': {
            borderColor: disabled ? 'divider' : 'primary.main',
            backgroundColor: disabled ? 'background.paper' : 'action.hover'
          }
        }}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={!uploadState.file ? handleBrowseClick : undefined}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          {getStatusIcon()}

          {!uploadState.file ? (
            <>
              <Typography variant="h6" color={getStatusColor()}>
                {isDragOver ? 'Drop your plugin file here' : 'Upload Plugin Archive'}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Drag and drop your plugin archive file here, or click to browse
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Supported formats: ZIP, RAR, TAR.GZ • Max size: {formatFileSize(maxSize)}
              </Typography>
              <Button
                variant="outlined"
                startIcon={<CloudUploadIcon />}
                disabled={disabled}
                onClick={handleBrowseClick}
              >
                Browse Files
              </Button>
            </>
          ) : (
            <>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <FileIcon color="action" />
                <Typography variant="body1" sx={{ fontWeight: 'medium' }}>
                  {uploadState.file.name}
                </Typography>
                <IconButton
                  size="small"
                  onClick={handleRemoveFile}
                  disabled={disabled || uploadState.uploading}
                  aria-label="Remove file"
                >
                  <ClearIcon />
                </IconButton>
              </Box>

              <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
                <Chip
                  label={formatFileSize(uploadState.file.size)}
                  size="small"
                  variant="outlined"
                />
                {validation && (
                  <Chip
                    label={validation.format.toUpperCase()}
                    size="small"
                    variant="outlined"
                    color={validation.isValid ? 'success' : 'error'}
                  />
                )}
              </Box>

              {uploadState.uploading && (
                <Box sx={{ width: '100%', mt: 2 }}>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    Uploading... {uploadState.progress}%
                  </Typography>
                  <LinearProgress
                    variant="determinate"
                    value={uploadState.progress}
                    sx={{ height: 8, borderRadius: 4 }}
                  />
                </Box>
              )}
            </>
          )}
        </Box>
      </Paper>

      {/* Validation Error */}
      {validation && !validation.isValid && (
        <Alert severity="error" sx={{ mt: 2 }}>
          <Typography variant="body2" sx={{ fontWeight: 'medium' }}>
            File Validation Error
          </Typography>
          <Typography variant="body2">
            {validation.error}
          </Typography>
        </Alert>
      )}

      {/* Upload Error */}
      {uploadState.error && (
        <Alert severity="error" sx={{ mt: 2 }}>
          <Typography variant="body2" sx={{ fontWeight: 'medium' }}>
            Upload Error
          </Typography>
          <Typography variant="body2">
            {uploadState.error}
          </Typography>
        </Alert>
      )}

      {/* Success Message */}
      {uploadState.file && validation?.isValid && !uploadState.uploading && !uploadState.error && (
        <Alert severity="success" sx={{ mt: 2 }}>
          <Typography variant="body2">
            File is ready for installation. Click "Install Plugin" to proceed.
          </Typography>
        </Alert>
      )}
    </Box>
  );
};

export default FileUploadZone;