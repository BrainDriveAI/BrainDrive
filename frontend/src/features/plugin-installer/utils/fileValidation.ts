import { 
  ArchiveValidationResult, 
  SUPPORTED_ARCHIVE_FORMATS, 
  MAX_FILE_SIZE, 
  MIN_FILE_SIZE,
  SupportedArchiveFormat 
} from '../types';

/**
 * Validates an uploaded archive file for plugin installation
 */
export const validateArchiveFile = (file: File): ArchiveValidationResult => {
  // Check file size
  if (file.size < MIN_FILE_SIZE) {
    return {
      isValid: false,
      format: 'unknown',
      size: file.size,
      error: `File is too small. Minimum size is ${MIN_FILE_SIZE / 1024}KB`
    };
  }

  if (file.size > MAX_FILE_SIZE) {
    return {
      isValid: false,
      format: 'unknown',
      size: file.size,
      error: `File is too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB`
    };
  }

  // Detect archive format
  const format = detectArchiveFormat(file.name);
  
  if (format === 'unknown') {
    return {
      isValid: false,
      format: 'unknown',
      size: file.size,
      error: `Unsupported file format. Supported formats: ${SUPPORTED_ARCHIVE_FORMATS.join(', ')}`
    };
  }

  // Additional MIME type validation
  const expectedMimeTypes = getMimeTypesForFormat(format);
  if (expectedMimeTypes.length > 0 && !expectedMimeTypes.includes(file.type)) {
    // Don't fail validation based on MIME type alone, as it can be unreliable
    console.warn(`MIME type mismatch: expected ${expectedMimeTypes.join(' or ')}, got ${file.type}`);
  }

  return {
    isValid: true,
    format,
    size: file.size
  };
};

/**
 * Detects archive format from filename
 */
export const detectArchiveFormat = (filename: string): ArchiveValidationResult['format'] => {
  const lowerName = filename.toLowerCase();
  
  if (lowerName.endsWith('.zip')) {
    return 'zip';
  }
  
  if (lowerName.endsWith('.rar')) {
    return 'rar';
  }
  
  if (lowerName.endsWith('.tar.gz') || lowerName.endsWith('.tgz')) {
    return 'tar.gz';
  }
  
  return 'unknown';
};

/**
 * Gets expected MIME types for a given archive format
 */
export const getMimeTypesForFormat = (format: ArchiveValidationResult['format']): string[] => {
  switch (format) {
    case 'zip':
      return ['application/zip', 'application/x-zip-compressed'];
    case 'rar':
      return ['application/vnd.rar', 'application/x-rar-compressed'];
    case 'tar.gz':
      return ['application/gzip', 'application/x-gzip', 'application/x-tar'];
    default:
      return [];
  }
};

/**
 * Formats file size for display
 */
export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

/**
 * Checks if a file extension is supported
 */
export const isSupportedArchiveFormat = (filename: string): boolean => {
  const format = detectArchiveFormat(filename);
  return format !== 'unknown';
};

/**
 * Gets file extension from filename
 */
export const getFileExtension = (filename: string): string => {
  const lowerName = filename.toLowerCase();
  
  if (lowerName.endsWith('.tar.gz')) {
    return '.tar.gz';
  }
  
  const lastDot = filename.lastIndexOf('.');
  return lastDot !== -1 ? filename.substring(lastDot) : '';
};

/**
 * Validates multiple files for batch upload (future enhancement)
 */
export const validateMultipleFiles = (files: FileList | File[]): {
  valid: File[];
  invalid: Array<{ file: File; error: string }>;
} => {
  const valid: File[] = [];
  const invalid: Array<{ file: File; error: string }> = [];
  
  Array.from(files).forEach(file => {
    const validation = validateArchiveFile(file);
    if (validation.isValid) {
      valid.push(file);
    } else {
      invalid.push({ file, error: validation.error || 'Unknown validation error' });
    }
  });
  
  return { valid, invalid };
};

/**
 * Creates a safe filename for upload
 */
export const sanitizeFilename = (filename: string): string => {
  // Remove or replace unsafe characters
  return filename
    .replace(/[^a-zA-Z0-9.-]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '');
};