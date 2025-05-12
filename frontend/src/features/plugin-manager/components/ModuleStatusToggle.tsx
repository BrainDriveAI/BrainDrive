import React, { useState } from 'react';
import { Switch, FormControlLabel, CircularProgress } from '@mui/material';

interface ModuleStatusToggleProps {
  moduleId: string;
  pluginId: string;
  enabled: boolean;
  onChange: (enabled: boolean) => Promise<void>;
  disabled?: boolean;
}

/**
 * A toggle component for enabling/disabling modules
 */
export const ModuleStatusToggle: React.FC<ModuleStatusToggleProps> = ({
  moduleId,
  pluginId,
  enabled,
  onChange,
  disabled = false
}) => {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(enabled);

  const handleChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const newStatus = event.target.checked;
    
    try {
      setLoading(true);
      await onChange(newStatus);
      setStatus(newStatus);
    } catch (error) {
      console.error(`Failed to toggle module status for ${moduleId}:`, error);
      // Revert to previous state on error
      setStatus(status);
    } finally {
      setLoading(false);
    }
  };

  return (
    <FormControlLabel
      control={
        loading ? (
          <CircularProgress size={24} />
        ) : (
          <Switch
            checked={status}
            onChange={handleChange}
            disabled={disabled || loading}
          />
        )
      }
      label={status ? 'Enabled' : 'Disabled'}
      labelPlacement="end"
    />
  );
};

export default ModuleStatusToggle;
