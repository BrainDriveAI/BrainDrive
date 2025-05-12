import React from 'react';
import { 
  Box, 
  FormControl, 
  InputLabel, 
  Select, 
  MenuItem, 
  Chip,
  OutlinedInput,
  SelectChangeEvent,
  Button
} from '@mui/material';
import FilterListIcon from '@mui/icons-material/FilterList';

interface ModuleFiltersProps {
  categories: string[];
  selectedCategory: string | null;
  onCategoryChange: (category: string | null) => void;
  tags: string[];
  selectedTags: string[];
  onTagsChange: (tags: string[]) => void;
}

/**
 * A component for filtering modules by category, tags, etc.
 */
export const ModuleFilters: React.FC<ModuleFiltersProps> = ({
  categories,
  selectedCategory,
  onCategoryChange,
  tags,
  selectedTags,
  onTagsChange
}) => {
  const handleCategoryChange = (event: SelectChangeEvent<string>) => {
    const value = event.target.value;
    onCategoryChange(value === 'all' ? null : value);
  };

  const handleTagsChange = (event: SelectChangeEvent<string[]>) => {
    const value = event.target.value;
    onTagsChange(typeof value === 'string' ? [value] : value);
  };

  const handleClearFilters = () => {
    onCategoryChange(null);
    onTagsChange([]);
  };

  const hasActiveFilters = selectedCategory !== null || selectedTags.length > 0;

  return (
    <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
      <FormControl sx={{ minWidth: 200 }}>
        <InputLabel id="category-filter-label">Category</InputLabel>
        <Select
          labelId="category-filter-label"
          value={selectedCategory || 'all'}
          label="Category"
          onChange={handleCategoryChange}
        >
          <MenuItem value="all">All Categories</MenuItem>
          {categories.map((category) => (
            <MenuItem key={category} value={category}>
              {category}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <FormControl sx={{ minWidth: 200, flexGrow: 1 }}>
        <InputLabel id="tags-filter-label">Tags</InputLabel>
        <Select
          labelId="tags-filter-label"
          multiple
          value={selectedTags}
          onChange={handleTagsChange}
          input={<OutlinedInput label="Tags" />}
          renderValue={(selected) => (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {selected.map((value) => (
                <Chip key={value} label={value} size="small" />
              ))}
            </Box>
          )}
        >
          {tags.map((tag) => (
            <MenuItem key={tag} value={tag}>
              {tag}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      {hasActiveFilters && (
        <Button 
          variant="outlined" 
          onClick={handleClearFilters}
          startIcon={<FilterListIcon />}
          sx={{ height: 56 }}
        >
          Clear Filters
        </Button>
      )}
    </Box>
  );
};

export default ModuleFilters;
