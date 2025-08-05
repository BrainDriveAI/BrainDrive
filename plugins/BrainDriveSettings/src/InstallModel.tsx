import React from 'react';
import { CloseIcon, PlusIcon } from './icons';
import './InstallModel.css';

interface ModelInstallDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onInstall: (modelName: string) => void;
  isLoading?: boolean;
  services?: {
    theme?: {
      getCurrentTheme: () => string;
      addThemeChangeListener: (callback: (theme: string) => void) => void;
      removeThemeChangeListener: (callback: (theme: string) => void) => void;
    };
    api?: {
      get: (url: string, options?: any) => Promise<any>;
      post: (url: string, data: any, config?: any) => Promise<any>;
      delete: (url: string, options?: any) => Promise<any>;
    };
  };
  serverAddress?: string;
  apiKey?: string;
}

interface ModelInstallDialogState {
  modelName: string;
  currentTheme: string;
  errorMessage: string;
}

class ModelInstallDialog extends React.Component<ModelInstallDialogProps, ModelInstallDialogState> {
  private themeChangeListener: ((theme: string) => void) | null = null;

  constructor(props: ModelInstallDialogProps) {
    super(props);
    
    this.state = {
      modelName: '',
      currentTheme: 'light',
      errorMessage: '',
    };
  }

  componentDidMount() {
    this.initializeThemeService();
  }

  componentWillUnmount() {
    if (this.props.services?.theme && this.themeChangeListener) {
      this.props.services.theme.removeThemeChangeListener(this.themeChangeListener);
    }
  }

  initializeThemeService() {
    if (this.props.services?.theme) {
      try {
        const currentTheme = this.props.services.theme.getCurrentTheme();
        this.setState({ currentTheme });
        
        this.themeChangeListener = (newTheme: string) => {
          this.setState({ currentTheme: newTheme });
        };
        
        this.props.services.theme.addThemeChangeListener(this.themeChangeListener);
      } catch (error) {
        console.error('Error initializing theme service:', error);
      }
    } else {
      // Fallback: try to detect theme from DOM
      const isDarkTheme = document.body.classList.contains('dark-theme') ||
                         document.documentElement.classList.contains('dark-theme') ||
                         document.body.classList.contains('vscode-dark');
      const fallbackTheme = isDarkTheme ? 'dark' : 'light';
      this.setState({ currentTheme: fallbackTheme });
    }
  }

  handleModelNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    this.setState({ 
      modelName: e.target.value,
      errorMessage: '' // Clear error when user types
    });
  };

  handleInstall = async () => {
    const { modelName } = this.state;
    
    if (!modelName.trim()) {
      this.setState({ errorMessage: 'Please enter a model name.' });
      return;
    }

    try {
      await this.props.onInstall(modelName.trim());
      // Close modal immediately on success
      this.handleClose();
      
    } catch (error: any) {
      const errorMessage = error?.response?.data?.detail || error.message || 'Unknown error occurred';
      this.setState({
        errorMessage: errorMessage
      });
    }
  };

  handleClose = () => {
    this.setState({
      modelName: '',
      errorMessage: ''
    });
    this.props.onClose();
  };

  handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      this.handleInstall();
    }
  };

  render() {
    const { isOpen } = this.props;
    const { modelName, currentTheme, errorMessage } = this.state;

    if (!isOpen) return null;

    const themeClass = currentTheme === 'dark' ? 'dark-theme' : '';
    const canInstall = modelName.trim().length > 0;

    return (
      <div className={`install-modal-overlay ${themeClass}`} onClick={this.handleClose}>
        <div className="install-modal-content" onClick={(e) => e.stopPropagation()}>
          <div className="install-modal-header">
            <h3>Install Ollama Model</h3>
            <button 
              className="install-modal-close" 
              onClick={this.handleClose}
              aria-label="Close"
            >
              <CloseIcon />
            </button>
          </div>

          <div className="install-modal-body">
            {errorMessage && (
              <div className="install-error">
                {errorMessage}
              </div>
            )}



            <div className="install-input-group">
              <label className="install-input-label">
                Model Name
              </label>
              <input
                type="text"
                className="install-input-field"
                value={modelName}
                onChange={this.handleModelNameChange}
                onKeyPress={this.handleKeyPress}
                placeholder="e.g., llama3.1:8b, deepseek-r1:1.5b"
              />
            </div>

            <div className="install-library-link">
              <a 
                href="https://ollama.com/library" 
                target="_blank" 
                rel="noopener noreferrer"
              >
                Browse Ollama Library
              </a>
            </div>
          </div>

          <div className="install-modal-footer">
            <button
              className="install-button install-button-secondary"
              onClick={this.handleClose}
            >
              Cancel
            </button>
            <button
              className="install-button install-button-primary"
              onClick={this.handleInstall}
              disabled={!canInstall}
            >
              <PlusIcon />
              Install Model
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default ModelInstallDialog; 