import React from 'react';
import { 
  Box, 
  Typography, 
  Chip, 
  Button, 
  Divider,
  Paper
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { Module, Plugin } from '../types';
import ModuleStatusToggle from './ModuleStatusToggle';

interface ModuleDetailHeaderProps {
  module: Module;
  plugin: Plugin;
  onBack: () => void;
  onToggleStatus: (enabled: boolean) => Promise<void>;
}

/**
 * Header component for the module detail page
 */
export const ModuleDetailHeader: React.FC<ModuleDetailHeaderProps> = ({
  module,
  plugin,
  onBack,
  onToggleStatus
}) => {
  return (
    <Paper sx={{ p: 3, mb: 3 }}>
      <Button
        startIcon={<ArrowBackIcon />}
        onClick={onBack}
        sx={{ mb: 2 }}
      >
        Back to Plugin Manager
      </Button>
      
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          {module.displayName || module.name}
        </Typography>
        
        <ModuleStatusToggle
          moduleId={module.id}
          pluginId={module.pluginId}
          enabled={module.enabled}
          onChange={onToggleStatus}
        />
      </Box>
      
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 3 }}>
        <Typography variant="body1">
          <strong>Plugin:</strong> {plugin.name} (v{plugin.version})
        </Typography>
        
        {module.author && (
          <Typography variant="body1">
            <strong>Author:</strong> {module.author}
          </Typography>
        )}
        
        {module.category && (
          <Typography variant="body1">
            <strong>Category:</strong> {module.category}
          </Typography>
        )}
        
        {module.lastUpdated && (
          <Typography variant="body1">
            <strong>Updated:</strong> {new Date(module.lastUpdated).toLocaleDateString()}
          </Typography>
        )}
      </Box>
      
      {module.description && (
        <>
          <Divider sx={{ my: 2 }} />
          <Typography variant="h6" gutterBottom>Description</Typography>
          <Typography variant="body1" paragraph>
            {module.description}
          </Typography>
        </>
      )}
      
      {module.tags && module.tags.length > 0 && (
        <>
          <Divider sx={{ my: 2 }} />
          <Typography variant="h6" gutterBottom>Tags</Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {module.tags.map((tag) => (
              <Chip key={tag} label={tag} />
            ))}
          </Box>
        </>
      )}
    </Paper>
  );
};

export default ModuleDetailHeader;
