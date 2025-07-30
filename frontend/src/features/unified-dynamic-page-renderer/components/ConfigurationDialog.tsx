import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { RenderMode, LayoutItem, ModuleConfig } from '../types/core';
import { BreakpointInfo } from '../types/responsive';

export interface ConfigField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'boolean' | 'select' | 'color' | 'textarea' | 'json' | 'slider' | 'file';
  description?: string;
  required?: boolean;
  defaultValue?: any;
  validation?: (value: any) => string | null;
  options?: Array<{ label: string; value: any }>;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  rows?: number;
  accept?: string; // for file inputs
  responsive?: boolean; // if true, field can have different values per breakpoint
}

export interface ConfigurationDialogProps {
  open: boolean;
  onClose: () => void;
  
  // Item being configured
  item: LayoutItem | null;
  
  // Configuration schema
  configFields: ConfigField[];
  
  // Current context
  mode: RenderMode;
  breakpoint: BreakpointInfo;
  
  // Event handlers
  onSave: (config: ModuleConfig) => void;
  onValidate?: (config: ModuleConfig) => Record<string, string>;
  
  // Customization
  title?: string;
  maxWidth?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  fullScreen?: boolean;
}

export const ConfigurationDialog: React.FC<ConfigurationDialogProps> = ({
  open,
  onClose,
  item,
  configFields,
  mode,
  breakpoint,
  onSave,
  onValidate,
  title = 'Configure Module',
  maxWidth = 'md',
  fullScreen = false
}) => {
  // State
  const [config, setConfig] = useState<ModuleConfig>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'general' | 'responsive' | 'advanced'>('general');
  const [responsiveMode, setResponsiveMode] = useState(false);

  // Initialize config when item changes
  useEffect(() => {
    if (item) {
      setConfig(item.config || {});
      setErrors({});
    }
  }, [item]);

  // Validate configuration
  const validateConfig = useCallback((configToValidate: ModuleConfig): Record<string, string> => {
    const validationErrors: Record<string, string> = {};
    
    // Field-level validation
    configFields.forEach(field => {
      const value = configToValidate[field.key];
      
      // Required field validation
      if (field.required && (value === undefined || value === null || value === '')) {
        validationErrors[field.key] = `${field.label} is required`;
        return;
      }
      
      // Custom validation
      if (field.validation && value !== undefined && value !== null) {
        const error = field.validation(value);
        if (error) {
          validationErrors[field.key] = error;
        }
      }
      
      // Type-specific validation
      if (value !== undefined && value !== null) {
        switch (field.type) {
          case 'number':
            if (isNaN(Number(value))) {
              validationErrors[field.key] = `${field.label} must be a number`;
            } else {
              const numValue = Number(value);
              if (field.min !== undefined && numValue < field.min) {
                validationErrors[field.key] = `${field.label} must be at least ${field.min}`;
              }
              if (field.max !== undefined && numValue > field.max) {
                validationErrors[field.key] = `${field.label} must be at most ${field.max}`;
              }
            }
            break;
          case 'json':
            try {
              JSON.parse(value);
            } catch {
              validationErrors[field.key] = `${field.label} must be valid JSON`;
            }
            break;
        }
      }
    });
    
    // External validation
    if (onValidate) {
      const externalErrors = onValidate(configToValidate);
      Object.assign(validationErrors, externalErrors);
    }
    
    return validationErrors;
  }, [configFields, onValidate]);

  // Handle field change
  const handleFieldChange = useCallback((fieldKey: string, value: any, breakpointName?: string) => {
    setConfig(prev => {
      const newConfig = { ...prev };
      
      if (breakpointName && responsiveMode) {
        // Update responsive configuration
        if (!newConfig.responsive) {
          newConfig.responsive = {};
        }
        
        // Type-safe responsive config access
        const responsiveConfig = newConfig.responsive as Record<string, any>;
        if (!responsiveConfig[breakpointName]) {
          responsiveConfig[breakpointName] = {};
        }
        responsiveConfig[breakpointName][fieldKey] = value;
      } else {
        // Update base configuration
        newConfig[fieldKey] = value;
      }
      
      return newConfig;
    });
    
    // Clear error for this field
    if (errors[fieldKey]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[fieldKey];
        return newErrors;
      });
    }
  }, [responsiveMode, errors]);

  // Handle save
  const handleSave = useCallback(async () => {
    const validationErrors = validateConfig(config);
    
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }
    
    setIsSaving(true);
    try {
      await onSave(config);
      onClose();
    } catch (error) {
      console.error('Failed to save configuration:', error);
      setErrors({ _general: 'Failed to save configuration. Please try again.' });
    } finally {
      setIsSaving(false);
    }
  }, [config, validateConfig, onSave, onClose]);

  // Get field value (considering responsive mode)
  const getFieldValue = useCallback((field: ConfigField, breakpointName?: string) => {
    if (breakpointName && responsiveMode && config.responsive) {
      const responsiveConfig = config.responsive as Record<string, any>;
      if (responsiveConfig[breakpointName]) {
        return responsiveConfig[breakpointName][field.key];
      }
    }
    return config[field.key] ?? field.defaultValue;
  }, [config, responsiveMode]);

  // Group fields by category
  const fieldGroups = useMemo(() => {
    const groups = {
      general: configFields.filter(f => !f.responsive),
      responsive: configFields.filter(f => f.responsive),
      advanced: configFields.filter(f => f.type === 'json' || f.key.startsWith('_'))
    };
    return groups;
  }, [configFields]);

  // Render field input
  const renderField = useCallback((field: ConfigField, breakpointName?: string) => {
    const value = getFieldValue(field, breakpointName);
    const fieldKey = breakpointName ? `${field.key}_${breakpointName}` : field.key;
    const hasError = errors[field.key];
    
    const commonProps = {
      id: fieldKey,
      value: value || '',
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        let newValue: any = e.target.value;
        
        // Type conversion
        if (field.type === 'number') {
          newValue = newValue === '' ? undefined : Number(newValue);
        } else if (field.type === 'boolean') {
          newValue = (e.target as HTMLInputElement).checked;
        }
        
        handleFieldChange(field.key, newValue, breakpointName);
      },
      className: `config-field__input ${hasError ? 'config-field__input--error' : ''}`,
      placeholder: field.placeholder
    };
    
    switch (field.type) {
      case 'text':
        return <input type="text" {...commonProps} />;
      
      case 'number':
        return (
          <input 
            type="number" 
            {...commonProps}
            min={field.min}
            max={field.max}
            step={field.step}
          />
        );
      
      case 'boolean':
        return (
          <input 
            type="checkbox" 
            id={fieldKey}
            checked={Boolean(value)}
            onChange={commonProps.onChange}
            className={`config-field__checkbox ${hasError ? 'config-field__checkbox--error' : ''}`}
          />
        );
      
      case 'select':
        return (
          <select {...commonProps}>
            <option value="">Select...</option>
            {field.options?.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        );
      
      case 'color':
        return <input type="color" {...commonProps} />;
      
      case 'textarea':
        return (
          <textarea 
            {...commonProps}
            rows={field.rows || 3}
          />
        );
      
      case 'json':
        return (
          <textarea 
            {...commonProps}
            rows={field.rows || 6}
            value={typeof value === 'object' ? JSON.stringify(value, null, 2) : value || ''}
            onChange={(e) => {
              try {
                const parsed = JSON.parse(e.target.value);
                handleFieldChange(field.key, parsed, breakpointName);
              } catch {
                handleFieldChange(field.key, e.target.value, breakpointName);
              }
            }}
          />
        );
      
      case 'slider':
        return (
          <div className="config-field__slider">
            <input 
              type="range"
              {...commonProps}
              min={field.min}
              max={field.max}
              step={field.step}
            />
            <span className="config-field__slider-value">{value}</span>
          </div>
        );
      
      case 'file':
        return (
          <input 
            type="file"
            id={fieldKey}
            accept={field.accept}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                // For now, just store the file name
                // In a real implementation, you'd upload the file
                handleFieldChange(field.key, file.name, breakpointName);
              }
            }}
            className={`config-field__file ${hasError ? 'config-field__file--error' : ''}`}
          />
        );
      
      default:
        return <input type="text" {...commonProps} />;
    }
  }, [getFieldValue, errors, handleFieldChange]);

  if (!open || !item) return null;

  const shouldShowResponsiveTab = fieldGroups.responsive.length > 0;
  const shouldShowAdvancedTab = fieldGroups.advanced.length > 0;

  return (
    <div className="configuration-dialog-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`configuration-dialog configuration-dialog--${maxWidth} ${fullScreen ? 'configuration-dialog--fullscreen' : ''}`}>
        {/* Header */}
        <div className="configuration-dialog__header">
          <h2 className="configuration-dialog__title">{title}</h2>
          <button 
            className="configuration-dialog__close"
            onClick={onClose}
            disabled={isSaving}
            aria-label="Close dialog"
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="configuration-dialog__tabs">
          <button 
            className={`configuration-dialog__tab ${activeTab === 'general' ? 'configuration-dialog__tab--active' : ''}`}
            onClick={() => setActiveTab('general')}
          >
            General
          </button>
          {shouldShowResponsiveTab && (
            <button 
              className={`configuration-dialog__tab ${activeTab === 'responsive' ? 'configuration-dialog__tab--active' : ''}`}
              onClick={() => setActiveTab('responsive')}
            >
              Responsive
            </button>
          )}
          {shouldShowAdvancedTab && (
            <button 
              className={`configuration-dialog__tab ${activeTab === 'advanced' ? 'configuration-dialog__tab--active' : ''}`}
              onClick={() => setActiveTab('advanced')}
            >
              Advanced
            </button>
          )}
        </div>

        {/* Content */}
        <div className="configuration-dialog__content">
          {/* General Tab */}
          {activeTab === 'general' && (
            <div className="configuration-dialog__tab-content">
              {fieldGroups.general.map(field => (
                <div key={field.key} className="config-field">
                  <label htmlFor={field.key} className="config-field__label">
                    {field.label}
                    {field.required && <span className="config-field__required">*</span>}
                  </label>
                  {field.description && (
                    <p className="config-field__description">{field.description}</p>
                  )}
                  {renderField(field)}
                  {errors[field.key] && (
                    <span className="config-field__error">{errors[field.key]}</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Responsive Tab */}
          {activeTab === 'responsive' && shouldShowResponsiveTab && (
            <div className="configuration-dialog__tab-content">
              <div className="configuration-dialog__responsive-controls">
                <label className="config-field__label">
                  <input 
                    type="checkbox"
                    checked={responsiveMode}
                    onChange={(e) => setResponsiveMode(e.target.checked)}
                  />
                  Enable responsive configuration
                </label>
              </div>
              
              {responsiveMode ? (
                <div className="configuration-dialog__breakpoints">
                  {['mobile', 'tablet', 'desktop', 'wide'].map(bp => (
                    <div key={bp} className="configuration-dialog__breakpoint">
                      <h4 className="configuration-dialog__breakpoint-title">
                        {bp.charAt(0).toUpperCase() + bp.slice(1)}
                        {bp === breakpoint.name && <span className="configuration-dialog__current-breakpoint">(current)</span>}
                      </h4>
                      {fieldGroups.responsive.map(field => (
                        <div key={`${field.key}_${bp}`} className="config-field">
                          <label htmlFor={`${field.key}_${bp}`} className="config-field__label">
                            {field.label}
                          </label>
                          {renderField(field, bp)}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="configuration-dialog__responsive-disabled">
                  <p>Enable responsive configuration to set different values for each breakpoint.</p>
                </div>
              )}
            </div>
          )}

          {/* Advanced Tab */}
          {activeTab === 'advanced' && shouldShowAdvancedTab && (
            <div className="configuration-dialog__tab-content">
              {fieldGroups.advanced.map(field => (
                <div key={field.key} className="config-field">
                  <label htmlFor={field.key} className="config-field__label">
                    {field.label}
                    {field.required && <span className="config-field__required">*</span>}
                  </label>
                  {field.description && (
                    <p className="config-field__description">{field.description}</p>
                  )}
                  {renderField(field)}
                  {errors[field.key] && (
                    <span className="config-field__error">{errors[field.key]}</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* General error */}
          {errors._general && (
            <div className="configuration-dialog__general-error">
              {errors._general}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="configuration-dialog__footer">
          <button 
            className="configuration-dialog__button configuration-dialog__button--secondary"
            onClick={onClose}
            disabled={isSaving}
          >
            Cancel
          </button>
          <button 
            className="configuration-dialog__button configuration-dialog__button--primary"
            onClick={handleSave}
            disabled={isSaving || Object.keys(errors).length > 0}
          >
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfigurationDialog;