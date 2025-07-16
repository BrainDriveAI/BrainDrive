import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Container,
  Typography,
  Box,
  Breadcrumbs,
  Link,
  Alert,
  CircularProgress,
  Paper
} from '@mui/material';
import { ArrowBack as ArrowBackIcon } from '@mui/icons-material';
import PersonaForm from '../features/personas/components/PersonaForm';
import { Persona } from '../features/personas/types';
import { personaService } from '../features/personas/services/personaService';

/**
 * Page for creating and editing personas
 */
const PersonaFormPage: React.FC = () => {
  const { personaId } = useParams<{ personaId: string }>();
  const navigate = useNavigate();
  const isEditMode = Boolean(personaId);

  const [persona, setPersona] = useState<Persona | undefined>(undefined);
  const [loading, setLoading] = useState(isEditMode);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Load persona data for edit mode
  useEffect(() => {
    if (isEditMode && personaId) {
      loadPersona(personaId);
    }
  }, [isEditMode, personaId]);

  const loadPersona = async (id: string) => {
    try {
      setLoading(true);
      setError(null);
      const personaData = await personaService.getPersona(id);
      setPersona(personaData);
    } catch (err) {
      console.error('Error loading persona:', err);
      setError(err instanceof Error ? err.message : 'Failed to load persona');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (savedPersona: Persona) => {
    setSaving(true);
    try {
      // Navigate back to personas list or detail page
      if (isEditMode) {
        navigate(`/personas/${savedPersona.id}`);
      } else {
        navigate('/personas');
      }
    } catch (err) {
      console.error('Error after saving persona:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    if (isEditMode && personaId) {
      navigate(`/personas/${personaId}`);
    } else {
      navigate('/personas');
    }
  };

  const handleBackToPersonas = () => {
    navigate('/personas');
  };

  const handleBackToPersona = () => {
    if (personaId) {
      navigate(`/personas/${personaId}`);
    }
  };

  if (loading) {
    return (
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 200 }}>
          <CircularProgress />
        </Box>
      </Container>
    );
  }

  if (error) {
    return (
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <Link
            component="button"
            variant="body2"
            onClick={handleBackToPersonas}
            sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}
          >
            <ArrowBackIcon fontSize="small" />
            Back to Personas
          </Link>
        </Box>
      </Container>
    );
  }

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      {/* Breadcrumbs */}
      <Box sx={{ mb: 3 }}>
        <Breadcrumbs aria-label="breadcrumb">
          <Link
            component="button"
            variant="body2"
            onClick={handleBackToPersonas}
            sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}
          >
            Personas
          </Link>
          {isEditMode && persona && (
            <Link
              component="button"
              variant="body2"
              onClick={handleBackToPersona}
              sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}
            >
              {persona.name}
            </Link>
          )}
          <Typography color="text.primary">
            {isEditMode ? 'Edit' : 'Create'}
          </Typography>
        </Breadcrumbs>
      </Box>

      {/* Page Header */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          {isEditMode ? 'Edit Persona' : 'Create New Persona'}
        </Typography>
        {isEditMode && persona && (
          <Typography variant="body1" color="text.secondary">
            Editing: {persona.name}
          </Typography>
        )}
      </Box>

      {/* Form */}
      <PersonaForm
        persona={persona}
        onSave={handleSave}
        onCancel={handleCancel}
        loading={saving}
      />
    </Container>
  );
};

export default PersonaFormPage;