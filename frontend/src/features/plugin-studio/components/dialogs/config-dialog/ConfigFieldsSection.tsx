import React from 'react';
import {
  Box,
  Typography,
  Grid,
  Accordion,
  AccordionSummary,
  AccordionDetails
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { ConfigField } from './ConfigField';

interface ConfigFieldsSectionProps {
  configFields: any[];
  config: Record<string, any>;
  layoutConfig: Record<string, any>;
  configMode: Record<string, 'global' | 'layout'>;
  errors: Record<string, string>;
  currentDeviceType: string;
  handleConfigChange: (fieldName: string, value: any, event?: React.ChangeEvent<HTMLInputElement>) => void;
  handleConfigModeToggle: (fieldName: string) => void;
  handleInputFocus: (fieldName: string) => void;
  inputRefs: React.MutableRefObject<Record<string, HTMLInputElement | null>>;
}

export const ConfigFieldsSection = ({
  configFields,
  config,
  layoutConfig,
  configMode,
  errors,
  currentDeviceType,
  handleConfigChange,
  handleConfigModeToggle,
  handleInputFocus,
  inputRefs
}: ConfigFieldsSectionProps) => {
  if (configFields.length === 0) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="body1">
          This module does not have any configurable fields.
        </Typography>
      </Box>
    );
  }

  // Check if any fields have categories
  const hasCategories = configFields.some((field: any) => field.category !== undefined);

  if (hasCategories) {
    // Group fields by category
    const fieldsByCategory = configFields.reduce((acc: Record<string, any[]>, field: any) => {
      const category = field.category || 'General';
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push(field);
      return acc;
    }, {});

    return (
      <Box>
        {Object.entries(fieldsByCategory).map(([category, fields]: [string, any[]]) => (
          <Accordion key={category} defaultExpanded>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography variant="subtitle1">{category}</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Grid container spacing={2}>
                {fields.map((field: any) => (
                  <Grid item xs={12} key={field.name}>
                    <ConfigField
                      field={field}
                      fieldName={field.name}
                      value={configMode[field.name] === 'layout' ? layoutConfig[field.name] : config[field.name]}
                      error={errors[field.name]}
                      isLayoutSpecific={configMode[field.name] === 'layout'}
                      currentDeviceType={currentDeviceType}
                      handleConfigChange={handleConfigChange}
                      handleConfigModeToggle={handleConfigModeToggle}
                      handleInputFocus={handleInputFocus}
                      inputRefs={inputRefs}
                    />
                  </Grid>
                ))}
              </Grid>
            </AccordionDetails>
          </Accordion>
        ))}
      </Box>
    );
  } else {
    // Render fields without categories
    return (
      <Grid container spacing={2}>
        {configFields.map((field: any) => (
          <Grid item xs={12} key={field.name}>
            <ConfigField
              field={field}
              fieldName={field.name}
              value={configMode[field.name] === 'layout' ? layoutConfig[field.name] : config[field.name]}
              error={errors[field.name]}
              isLayoutSpecific={configMode[field.name] === 'layout'}
              currentDeviceType={currentDeviceType}
              handleConfigChange={handleConfigChange}
              handleConfigModeToggle={handleConfigModeToggle}
              handleInputFocus={handleInputFocus}
              inputRefs={inputRefs}
            />
          </Grid>
        ))}
      </Grid>
    );
  }
};