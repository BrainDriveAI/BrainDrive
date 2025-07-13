import React, { useState, useEffect } from 'react';
import {
  Box,
  TextField,
  Button,
  Typography,
  Paper,
  Grid,
  Chip,
  FormControlLabel,
  Switch,
  Slider,
  Alert,
  Divider,
  InputAdornment,
  Accordion,
  AccordionSummary,
  AccordionDetails
} from '@mui/material';
import { ExpandMore as ExpandMoreIcon } from '@mui/icons-material';
import { Persona, PersonaCreate, PersonaUpdate, ModelSettings } from '../types';
import { personaService } from '../services/personaService';

interface PersonaFormProps {
  persona?: Persona;
  onSave: (persona: Persona) => void;
  onCancel: () => void;
  loading?: boolean;
}

interface FormData {
  name: string;
  description: string;
  system_prompt: string;
  avatar: string;
  tags: string[];
  sample_greeting: string;
  is_active: boolean;
  model_settings: ModelSettings;
}

interface FormErrors {
  name?: string;
  system_prompt?: string;
  model_settings?: string[];
  general?: string;
}

const defaultModelSettings: ModelSettings = {
  temperature: 0.7,
  top_p: 0.9,
  frequency_penalty: 0,
  presence_penalty: 0,
  context_window: 4000,
  stop_sequences: []
};

export const PersonaForm: React.FC<PersonaFormProps> = ({
  persona,
  onSave,
  onCancel,
  loading = false
}) => {
  const [formData, setFormData] = useState<FormData>({
    name: persona?.name || '',
    description: persona?.description || '',
    system_prompt: persona?.system_prompt || '',
    avatar: persona?.avatar || '',
    tags: persona?.tags || [],
    sample_greeting: persona?.sample_greeting || '',
    is_active: persona?.is_active ?? true,
    model_settings: persona?.model_settings || defaultModelSettings
  });

  const [errors, setErrors] = useState<FormErrors>({});
  const [tagInput, setTagInput] = useState('');
  const [stopSequenceInput, setStopSequenceInput] = useState('');

  // Initialize stop sequences input from model settings
  useEffect(() => {
    if (formData.model_settings.stop_sequences) {
      setStopSequenceInput(formData.model_settings.stop_sequences.join('\n'));
    }
  }, []);

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {};

    // Required fields
    if (!formData.name.trim()) {
      newErrors.name = 'Name is required';
    } else if (formData.name.length > 100) {
      newErrors.name = 'Name must be 100 characters or less';
    }

    if (!formData.system_prompt.trim()) {
      newErrors.system_prompt = 'System prompt is required';
    }

    // Model settings validation
    const modelSettingsErrors = personaService.validateModelSettings(formData.model_settings);
    if (modelSettingsErrors.length > 0) {
      newErrors.model_settings = modelSettingsErrors;
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleInputChange = (field: keyof FormData) => (
    event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const value = event.target.type === 'checkbox' 
      ? (event.target as HTMLInputElement).checked 
      : event.target.value;
    
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));

    // Clear error when user starts typing
    if (errors[field as keyof FormErrors]) {
      setErrors(prev => ({
        ...prev,
        [field]: undefined
      }));
    }
  };

  const handleModelSettingChange = (setting: keyof ModelSettings) => (
    event: Event,
    value: number | number[]
  ) => {
    setFormData(prev => ({
      ...prev,
      model_settings: {
        ...prev.model_settings,
        [setting]: value as number
      }
    }));

    // Clear model settings errors
    if (errors.model_settings) {
      setErrors(prev => ({
        ...prev,
        model_settings: undefined
      }));
    }
  };

  const handleAddTag = () => {
    if (tagInput.trim() && !formData.tags.includes(tagInput.trim())) {
      setFormData(prev => ({
        ...prev,
        tags: [...prev.tags, tagInput.trim()]
      }));
      setTagInput('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setFormData(prev => ({
      ...prev,
      tags: prev.tags.filter(tag => tag !== tagToRemove)
    }));
  };

  const handleTagInputKeyPress = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleAddTag();
    }
  };

  const handleStopSequenceChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    setStopSequenceInput(value);
    
    const sequences = value.split('\n').filter(seq => seq.trim() !== '');
    setFormData(prev => ({
      ...prev,
      model_settings: {
        ...prev.model_settings,
        stop_sequences: sequences
      }
    }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    try {
      const personaData: PersonaCreate | PersonaUpdate = {
        name: formData.name.trim(),
        description: formData.description.trim() || undefined,
        system_prompt: formData.system_prompt.trim(),
        avatar: formData.avatar.trim() || undefined,
        tags: formData.tags.length > 0 ? formData.tags : undefined,
        sample_greeting: formData.sample_greeting.trim() || undefined,
        is_active: formData.is_active,
        model_settings: formData.model_settings
      };

      let savedPersona: Persona;
      if (persona) {
        // Update existing persona
        savedPersona = await personaService.updatePersona(persona.id, personaData);
      } else {
        // Create new persona
        savedPersona = await personaService.createPersona(personaData as PersonaCreate);
      }

      onSave(savedPersona);
    } catch (error) {
      console.error('Error saving persona:', error);
      setErrors({
        general: error instanceof Error ? error.message : 'Failed to save persona'
      });
    }
  };

  return (
    <Box component="form" onSubmit={handleSubmit} sx={{ maxWidth: 800, mx: 'auto' }}>
      {errors.general && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {errors.general}
        </Alert>
      )}

      {/* Basic Information */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Basic Information
        </Typography>
        
        <Grid container spacing={3}>
          <Grid item xs={12} sm={8}>
            <TextField
              fullWidth
              label="Name"
              value={formData.name}
              onChange={handleInputChange('name')}
              error={!!errors.name}
              helperText={errors.name}
              required
              inputProps={{ maxLength: 100 }}
            />
          </Grid>
          
          <Grid item xs={12} sm={4}>
            <TextField
              fullWidth
              label="Avatar (emoji or icon)"
              value={formData.avatar}
              onChange={handleInputChange('avatar')}
              placeholder="🤖"
            />
          </Grid>
          
          <Grid item xs={12}>
            <TextField
              fullWidth
              label="Description"
              value={formData.description}
              onChange={handleInputChange('description')}
              multiline
              rows={2}
              placeholder="Brief description of this persona..."
            />
          </Grid>
          
          <Grid item xs={12}>
            <FormControlLabel
              control={
                <Switch
                  checked={formData.is_active}
                  onChange={handleInputChange('is_active')}
                />
              }
              label="Active"
            />
          </Grid>
        </Grid>
      </Paper>

      {/* System Prompt */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          System Prompt
        </Typography>
        
        <TextField
          fullWidth
          label="System Prompt"
          value={formData.system_prompt}
          onChange={handleInputChange('system_prompt')}
          error={!!errors.system_prompt}
          helperText={errors.system_prompt || 'Define how this persona should behave and respond'}
          multiline
          rows={6}
          required
          placeholder="You are a helpful assistant that..."
        />
      </Paper>

      {/* Model Settings */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Accordion defaultExpanded>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="h6">Model Settings</Typography>
          </AccordionSummary>
          <AccordionDetails>
            {errors.model_settings && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {errors.model_settings.map((error, index) => (
                  <div key={index}>{error}</div>
                ))}
              </Alert>
            )}
            
            <Grid container spacing={3}>
              <Grid item xs={12} sm={6}>
                <Typography gutterBottom>
                  Temperature: {formData.model_settings.temperature}
                </Typography>
                <Slider
                  value={formData.model_settings.temperature || 0.7}
                  onChange={handleModelSettingChange('temperature')}
                  min={0}
                  max={2}
                  step={0.1}
                  marks={[
                    { value: 0, label: '0' },
                    { value: 1, label: '1' },
                    { value: 2, label: '2' }
                  ]}
                />
                <Typography variant="caption" color="text.secondary">
                  Controls randomness (0 = deterministic, 2 = very creative)
                </Typography>
              </Grid>
              
              <Grid item xs={12} sm={6}>
                <Typography gutterBottom>
                  Top-p: {formData.model_settings.top_p}
                </Typography>
                <Slider
                  value={formData.model_settings.top_p || 0.9}
                  onChange={handleModelSettingChange('top_p')}
                  min={0}
                  max={1}
                  step={0.1}
                  marks={[
                    { value: 0, label: '0' },
                    { value: 0.5, label: '0.5' },
                    { value: 1, label: '1' }
                  ]}
                />
                <Typography variant="caption" color="text.secondary">
                  Controls diversity (lower = more focused)
                </Typography>
              </Grid>
              
              <Grid item xs={12} sm={6}>
                <Typography gutterBottom>
                  Frequency Penalty: {formData.model_settings.frequency_penalty}
                </Typography>
                <Slider
                  value={formData.model_settings.frequency_penalty || 0}
                  onChange={handleModelSettingChange('frequency_penalty')}
                  min={-2}
                  max={2}
                  step={0.1}
                  marks={[
                    { value: -2, label: '-2' },
                    { value: 0, label: '0' },
                    { value: 2, label: '2' }
                  ]}
                />
                <Typography variant="caption" color="text.secondary">
                  Reduces repetition of frequent tokens
                </Typography>
              </Grid>
              
              <Grid item xs={12} sm={6}>
                <Typography gutterBottom>
                  Presence Penalty: {formData.model_settings.presence_penalty}
                </Typography>
                <Slider
                  value={formData.model_settings.presence_penalty || 0}
                  onChange={handleModelSettingChange('presence_penalty')}
                  min={-2}
                  max={2}
                  step={0.1}
                  marks={[
                    { value: -2, label: '-2' },
                    { value: 0, label: '0' },
                    { value: 2, label: '2' }
                  ]}
                />
                <Typography variant="caption" color="text.secondary">
                  Encourages talking about new topics
                </Typography>
              </Grid>
              
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Context Window"
                  type="number"
                  value={formData.model_settings.context_window || 4000}
                  onChange={(e) => {
                    const value = parseInt(e.target.value) || 4000;
                    setFormData(prev => ({
                      ...prev,
                      model_settings: {
                        ...prev.model_settings,
                        context_window: value
                      }
                    }));
                  }}
                  inputProps={{ min: 1, max: 32000 }}
                  helperText="Maximum tokens to remember from conversation"
                />
              </Grid>
              
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Stop Sequences"
                  value={stopSequenceInput}
                  onChange={handleStopSequenceChange}
                  multiline
                  rows={3}
                  placeholder="Human:&#10;Assistant:"
                  helperText="One sequence per line. Model will stop generating when it encounters these."
                />
              </Grid>
            </Grid>
          </AccordionDetails>
        </Accordion>
      </Paper>

      {/* Identity & Tags */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Identity & Tags
        </Typography>
        
        <Grid container spacing={3}>
          <Grid item xs={12}>
            <TextField
              fullWidth
              label="Sample Greeting"
              value={formData.sample_greeting}
              onChange={handleInputChange('sample_greeting')}
              multiline
              rows={2}
              placeholder="Hello! I'm here to help you with..."
              helperText="Optional greeting message that represents this persona"
            />
          </Grid>
          
          <Grid item xs={12}>
            <TextField
              fullWidth
              label="Add Tag"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyPress={handleTagInputKeyPress}
              placeholder="Enter a tag and press Enter"
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <Button onClick={handleAddTag} disabled={!tagInput.trim()}>
                      Add
                    </Button>
                  </InputAdornment>
                )
              }}
            />
            
            {formData.tags.length > 0 && (
              <Box sx={{ mt: 2, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {formData.tags.map((tag) => (
                  <Chip
                    key={tag}
                    label={tag}
                    onDelete={() => handleRemoveTag(tag)}
                    size="small"
                  />
                ))}
              </Box>
            )}
          </Grid>
        </Grid>
      </Paper>

      {/* Form Actions */}
      <Box sx={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
        <Button
          variant="outlined"
          onClick={onCancel}
          disabled={loading}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          variant="contained"
          disabled={loading}
        >
          {loading ? 'Saving...' : persona ? 'Update Persona' : 'Create Persona'}
        </Button>
      </Box>
    </Box>
  );
};

export default PersonaForm;