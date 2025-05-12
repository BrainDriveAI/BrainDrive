import React, { useState, useEffect, useMemo } from 'react';
import {
  Box,
  Typography,
  Tooltip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Chip,
  TextField,
  InputAdornment,
  IconButton,
  Paper
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Clear';
import { usePlugins } from '../../hooks';
import { useToolbar } from '../../context/ToolbarContext';
import { IconResolver } from '../common';

/**
 * Component that displays available plugins that can be dragged onto the canvas
 * @returns The plugin toolbar component
 */
export const PluginToolbar: React.FC = () => {
  const { availablePlugins, filterModules, createDragData } = usePlugins();
  const { isExpanded, toggleCategory } = useToolbar();
  const [searchTerm, setSearchTerm] = useState('');
  const [groupBy, setGroupBy] = useState<'plugin' | 'category'>('plugin');

  // Filter modules based on search term and exclude settings modules
  const filteredModules = useMemo(() => {
    return filterModules(searchTerm, ['settings']);
  }, [filterModules, searchTerm]);

  // Group modules by plugin or category
  const groupedModules = useMemo(() => {
    const groups: Record<string, any[]> = {};
    filteredModules.forEach(item => {
      const key = groupBy === 'plugin' ? item.pluginId : (item.module.category || 'General');
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    });
    return groups;
  }, [filteredModules, groupBy]);

  // Handle accordion expansion
  const handleAccordionChange = (panel: string) => (_event: React.SyntheticEvent, expanded: boolean) => {
    toggleCategory(panel);
  };

  // Handle drag start
  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, item: any) => {
    const dragData = createDragData(item.pluginId, item.module);
    const dragDataStr = JSON.stringify(dragData);
    
    // Set the data in multiple formats to ensure compatibility
    e.dataTransfer.setData('module', dragDataStr);
    e.dataTransfer.setData('text/plain', dragDataStr);
    
    // Log the drag data for debugging
    console.log('Drag start with data:', dragData);
    
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <Box sx={{ p: 2, overflowY: 'auto', height: '100%', position: 'relative' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 'medium' }}>Your Plugins</Typography>
        <Chip
          label={groupBy === 'plugin' ? 'By Plugin' : 'By Category'}
          onClick={() => setGroupBy(prev => (prev === 'plugin' ? 'category' : 'plugin'))}
          size="small"
          color="primary"
          variant="outlined"
        />
      </Box>

      <TextField
        fullWidth
        size="small"
        placeholder="Search modules..."
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        sx={{ mb: 2 }}
        InputProps={{
          startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>,
          endAdornment: searchTerm && (
            <InputAdornment position="end">
              <IconButton size="small" onClick={() => setSearchTerm('')} edge="end">
                <ClearIcon fontSize="small" />
              </IconButton>
            </InputAdornment>
          )
        }}
      />

      {Object.entries(groupedModules).length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', mt: 2 }}>
          No modules found
        </Typography>
      ) : (
        Object.entries(groupedModules).map(([groupName, items]) => (
          <Accordion
            key={groupName}
            expanded={isExpanded(groupName)}
            onChange={handleAccordionChange(groupName)}
            disableGutters
            elevation={0}
            sx={{
              backgroundColor: 'background.paper',
              mb: 1,
              border: 1,
              borderColor: 'divider',
              borderRadius: 1
            }}
          >
            <Tooltip
              title={
                <Box>
                  {groupBy === 'plugin' ? (
                    <>
                      <Typography variant="subtitle2">
                        {availablePlugins.find(p => p.id === groupName)?.name || groupName}
                      </Typography>
                      <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
                        ID: {groupName}
                      </Typography>
                      <Typography variant="body2">
                        {availablePlugins.find(p => p.id === groupName)?.description || 'No description available'}
                      </Typography>
                      <Typography variant="caption">
                        Author: {availablePlugins.find(p => p.id === groupName)?.author || 'Unknown'}
                      </Typography>
                    </>
                  ) : (
                    <>
                      <Typography variant="subtitle2">{groupName}</Typography>
                      <Typography variant="caption">Category: {groupName}</Typography>
                    </>
                  )}
                </Box>
              }
              placement="right"
              arrow
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ minHeight: '48px' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                  <IconResolver
                    icon={groupBy === 'plugin'
                      ? availablePlugins.find(p => p.id === groupName)?.icon || 'Extension'
                      : 'Category'}
                    fontSize="small"
                    sx={{ color: 'primary.main', mr: 1 }}
                  />
                  <Typography variant="subtitle2">
                    {groupBy === 'plugin'
                      ? `${availablePlugins.find(p => p.id === groupName)?.name || groupName} (${items.length})`
                      : `${groupName} (${items.length})`}
                  </Typography>
                </Box>
              </AccordionSummary>
            </Tooltip>

            <AccordionDetails sx={{ pt: 0, pb: 1 }}>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {items.map((item, index) => (
                  <Tooltip key={`${item.pluginId}-${item.module.id || index}`}
                    title={
                      <Box>
                        <Typography variant="subtitle2">{item.module.displayName || item.module.name}</Typography>
                        {item.module.description && (
                          <Typography variant="body2">{item.module.description}</Typography>
                        )}
                        {item.module.type && (
                          <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>
                            Type: {item.module.type}
                          </Typography>
                        )}
                        {groupBy === 'category' && (
                          <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>
                            From: {item.pluginName}
                          </Typography>
                        )}
                        {item.module.dependencies && item.module.dependencies.length > 0 && (
                          <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>
                            Dependencies: {item.module.dependencies.join(', ')}
                          </Typography>
                        )}
                      </Box>
                    }
                    placement="right"
                    arrow
                  >
                    <Box
                      draggable
                      onDragStart={(e) => handleDragStart(e, item)}
                      sx={{
                        p: 1.5,
                        bgcolor: 'background.paper',
                        border: 1,
                        borderColor: item.isLocal ? 'divider' : 'primary.light',
                        borderRadius: 1,
                        cursor: 'move',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1.5,
                        '&:hover': {
                          borderColor: 'primary.main',
                          bgcolor: 'action.hover'
                        },
                        // Apply priority-based styling
                        ...(item.module.priority && item.module.priority > 0 && {
                          borderWidth: 2,
                          borderColor: 'secondary.main',
                        })
                      }}
                    >
                      {/* Show module icon */}
                      <Box sx={{
                        color: item.isLocal ? 'primary.main' : 'secondary.main',
                        display: 'flex',
                        alignItems: 'center'
                      }}>
                        <IconResolver
                          icon={item.module.icon || availablePlugins.find(p => p.id === item.pluginId)?.icon || 'Extension'}
                          fontSize="small"
                        />
                      </Box>
                      <Box sx={{ flexGrow: 1, overflow: 'hidden' }}>
                        <Typography variant="body2" noWrap>
                          {item.module.displayName || item.module.name}
                        </Typography>
                        {/* Show module type if available */}
                        {item.module.type && (
                          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                            {item.module.type}
                          </Typography>
                        )}
                        {item.module.tags && item.module.tags.length > 0 && (
                          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                            {item.module.tags.slice(0, 2).map(tag => (
                              <Chip
                                key={tag}
                                label={tag}
                                size="small"
                                variant="outlined"
                                sx={{
                                  height: '18px',
                                  fontSize: '0.625rem',
                                  '& .MuiChip-label': { px: 0.5 }
                                }}
                              />
                            ))}
                            {item.module.tags.length > 2 && (
                              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                                +{item.module.tags.length - 2}
                              </Typography>
                            )}
                          </Box>
                        )}
                      </Box>
                    </Box>
                  </Tooltip>
                ))}
              </Box>
            </AccordionDetails>
          </Accordion>
        ))
      )}
    </Box>
  );
};