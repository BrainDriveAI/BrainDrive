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
import { DynamicPluginConfig, DynamicModuleConfig, DragData } from '../types/index';
import { getAvailablePlugins, onPluginRegistryChange, getAllModules } from '../plugins';
import { IconResolver } from './IconResolver';

export const PluginToolbar: React.FC<{ plugins?: DynamicPluginConfig[] }> = ({
  plugins: initialPlugins
}) => {
  const [plugins, setPlugins] = useState<DynamicPluginConfig[]>(initialPlugins || getAvailablePlugins());
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<'plugin' | 'category'>('plugin');

  useEffect(() => {
    if (initialPlugins) return;
    const unsubscribe = onPluginRegistryChange(() => setPlugins(getAvailablePlugins()));
    setPlugins(getAvailablePlugins());
    return unsubscribe;
  }, [initialPlugins]);

  const allModules = useMemo(() => {
    const moduleData = getAllModules();
    return moduleData.map(({ pluginId, module }) => {
      const plugin = plugins.find(p => p.id === pluginId);
      return {
        pluginId,
        pluginName: plugin?.name || pluginId,
        isLocal: plugin?.islocal || false,
        module
      };
    });
  }, [plugins]);

  const filteredModules = useMemo(() => {
    // First filter out modules with 'settings' tag (case-insensitive)
    const modulesWithoutSettings = allModules.filter(item => 
      !(item.module.tags || []).some(tag => tag.toLowerCase() === 'settings')
    );
    
    // Then apply search term filter if one exists
    if (!searchTerm) return modulesWithoutSettings;
    
    const lowerSearchTerm = searchTerm.toLowerCase();
    return modulesWithoutSettings.filter(item =>
      (item.module.displayName || item.module.name).toLowerCase().includes(lowerSearchTerm) ||
      (item.module.description || '').toLowerCase().includes(lowerSearchTerm) ||
      item.pluginName.toLowerCase().includes(lowerSearchTerm) ||
      (item.module.tags || []).some(tag => tag.toLowerCase().includes(lowerSearchTerm))
    );
  }, [allModules, searchTerm]);

  const groupedModules = useMemo(() => {
    const groups: Record<string, typeof filteredModules> = {};
    filteredModules.forEach(item => {
      const key = groupBy === 'plugin' ? item.pluginId : (item.module.category || 'General');
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    });
    return groups;
  }, [filteredModules, groupBy]);

  const handleAccordionChange = (panel: string) => (_event: React.SyntheticEvent, isExpanded: boolean) => {
    setExpandedCategory(isExpanded ? panel : null);
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
        fullWidth size="small" placeholder="Search modules..."
        value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
        sx={{ mb: 2 }}
        InputProps={{
          startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>,
          endAdornment: searchTerm && (
            <InputAdornment position="end">
              <IconButton size="small" onClick={() => setSearchTerm('')} edge="end"><ClearIcon fontSize="small" /></IconButton>
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
            expanded={expandedCategory === groupName}
            onChange={handleAccordionChange(groupName)}
            disableGutters
            elevation={0}
            sx={{ backgroundColor: 'background.paper', mb: 1, border: 1, borderColor: 'divider', borderRadius: 1 }}
          >
            {/* 🛠️ Added Tooltip Here for Accordion Header */}
            <Tooltip
              title={
                <Box>
                  <Typography variant="subtitle2">{groupName}</Typography>
                  {groupBy === 'plugin' ? (
                    <>
                      <Typography variant="body2">
                        {plugins.find(p => p.id === groupName)?.description || 'No description available'}
                      </Typography>
                      <Typography variant="caption">
                        Author: {plugins.find(p => p.id === groupName)?.author || 'Unknown'}
                      </Typography>
                    </>
                  ) : (
                    <Typography variant="caption">Category: {groupName}</Typography>
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
                      ? plugins.find(p => p.id === groupName)?.icon || 'Extension' 
                      : 'Category'} 
                    fontSize="small"
                    sx={{ color: 'primary.main', mr: 1 }}
                  />
                  <Typography variant="subtitle2">
                    {groupBy === 'plugin' ? `${groupName} (${items.length})` : `${groupName} (${items.length})`}
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
                      onDragStart={(e) => {
                        // Create drag data with all necessary information
                        const dragData: DragData = {
                          pluginId: item.pluginId,
                          moduleId: item.module.id || item.module.name,
                          moduleName: item.module.name,
                          displayName: item.module.displayName || item.module.name,
                          category: item.module.category || 'General',
                          isLocal: item.isLocal,
                          tags: item.module.tags || [],
                          description: item.module.description,
                          icon: item.module.icon,
                          type: item.module.type,
                          priority: item.module.priority,
                          dependencies: item.module.dependencies,
                          layout: item.module.layout
                        };
                        
                        e.dataTransfer.setData('module', JSON.stringify(dragData));
                        e.dataTransfer.effectAllowed = 'copy';
                      }}
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
                          icon={item.module.icon || plugins.find(p => p.id === item.pluginId)?.icon || 'Extension'} 
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
