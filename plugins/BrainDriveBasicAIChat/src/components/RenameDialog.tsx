import React from 'react';

interface RenameDialogProps {
  isOpen: boolean;
  currentTitle: string;
  onSave: (newTitle: string) => void;
  onCancel: () => void;
  theme: 'light' | 'dark';
}

interface RenameDialogState {
  title: string;
}

/**
 * RenameDialog component implemented as a class component
 * to avoid React hook issues in the module environment
 */
class RenameDialog extends React.Component<RenameDialogProps, RenameDialogState> {
  private inputRef: React.RefObject<HTMLInputElement>;
  
  constructor(props: RenameDialogProps) {
    super(props);
    
    this.state = {
      title: props.currentTitle
    };
    
    this.inputRef = React.createRef();
    
    // Bind methods
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleSave = this.handleSave.bind(this);
    this.handleInputChange = this.handleInputChange.bind(this);
  }
  
  componentDidUpdate(prevProps: RenameDialogProps) {
    // Reset title when dialog opens with new currentTitle
    if ((prevProps.isOpen !== this.props.isOpen && this.props.isOpen) || 
        (prevProps.currentTitle !== this.props.currentTitle)) {
      this.setState({ title: this.props.currentTitle });
    }
    
    // Focus input when dialog opens
    if (!prevProps.isOpen && this.props.isOpen && this.inputRef.current) {
      this.inputRef.current.focus();
      this.inputRef.current.select();
    }
  }
  
  handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      this.props.onCancel();
    } else if (e.key === 'Enter') {
      this.handleSave();
    }
  }
  
  handleSave() {
    const trimmedTitle = this.state.title.trim();
    if (trimmedTitle) {
      this.props.onSave(trimmedTitle);
    }
  }
  
  handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    this.setState({ title: e.target.value });
  }
  
  render() {
    const { isOpen, onCancel, theme } = this.props;
    const { title } = this.state;
    const dialogClass = theme === 'dark' ? 'dark-theme' : '';
    
    if (!isOpen) {
      return null;
    }
    
    return (
      <div className="rename-dialog-backdrop">
        <div className={`rename-dialog ${dialogClass}`} onKeyDown={this.handleKeyDown}>
          <div className="rename-dialog-header">Rename Conversation</div>
          <div className="rename-dialog-content">
            <label htmlFor="conversation-title" className="rename-dialog-label">
              Enter a new title:
            </label>
            <input
              ref={this.inputRef}
              id="conversation-title"
              type="text"
              className="rename-dialog-input"
              value={title}
              onChange={this.handleInputChange}
              placeholder="Conversation title"
              aria-label="Conversation title"
            />
          </div>
          <div className="rename-dialog-actions">
            <button className="history-button secondary" onClick={onCancel}>
              Cancel
            </button>
            <button 
              className="history-button primary" 
              onClick={this.handleSave}
              disabled={!title.trim()}
            >
              Save Changes
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default RenameDialog;