import React, { useState, useEffect, useCallback } from 'react';
import { TextField, InputAdornment, IconButton } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Clear';

interface ModuleSearchProps {
  onSearch: (query: string) => void;
  placeholder?: string;
  initialValue?: string;
}

/**
 * A search component for finding modules
 */
export const ModuleSearch: React.FC<ModuleSearchProps> = ({
  onSearch,
  placeholder = 'Search modules...',
  initialValue = ''
}) => {
  const [searchQuery, setSearchQuery] = useState(initialValue);
  const [debouncedQuery, setDebouncedQuery] = useState(initialValue);

  // Debounce search query to avoid excessive API calls
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 300);

    return () => {
      clearTimeout(handler);
    };
  }, [searchQuery]);

  // Call onSearch when debounced query changes
  useEffect(() => {
    onSearch(debouncedQuery);
  }, [debouncedQuery, onSearch]);

  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(event.target.value);
  };

  const handleClearSearch = useCallback(() => {
    setSearchQuery('');
  }, []);

  return (
    <TextField
      fullWidth
      variant="outlined"
      placeholder={placeholder}
      value={searchQuery}
      onChange={handleSearchChange}
      InputProps={{
        startAdornment: (
          <InputAdornment position="start">
            <SearchIcon color="action" />
          </InputAdornment>
        ),
        endAdornment: searchQuery ? (
          <InputAdornment position="end">
            <IconButton
              aria-label="clear search"
              onClick={handleClearSearch}
              edge="end"
              size="small"
            >
              <ClearIcon fontSize="small" />
            </IconButton>
          </InputAdornment>
        ) : null,
        sx: {
          borderRadius: 2,
          backgroundColor: 'background.paper',
        }
      }}
      sx={{
        mb: 2
      }}
    />
  );
};

export default ModuleSearch;
