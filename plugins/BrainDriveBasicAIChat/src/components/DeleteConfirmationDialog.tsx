import React from 'react';

interface DeleteConfirmationDialogProps {
  isOpen: boolean;
  conversationTitle: string;
  onConfirm: () => void;
  onCancel: () => void;
  theme: 'light' | 'dark';
}

/**
 * DeleteConfirmationDialog component implemented as a class component
 * to avoid React hook issues in the module environment
 */
class DeleteConfirmationDialog extends React.Component<DeleteConfirmationDialogProps> {
  private confirmButtonRef: React.RefObject<HTMLButtonElement>;
  
  constructor(props: DeleteConfirmationDialogProps) {
    super(props);
    
    this.confirmButtonRef = React.createRef();
    
    // Bind methods
    this.handleKeyDown = this.handleKeyDown.bind(this);
  }
  
  componentDidUpdate(prevProps: DeleteConfirmationDialogProps) {
    // Focus the confirm button when dialog opens
    if (!prevProps.isOpen && this.props.isOpen && this.confirmButtonRef.current) {
      this.confirmButtonRef.current.focus();
    }
  }
  
  handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      this.props.onCancel();
    }
  }
  
  render() {
    const { isOpen, conversationTitle, onConfirm, onCancel, theme } = this.props;
    const dialogClass = theme === 'dark' ? 'dark-theme' : '';
    
    if (!isOpen) {
      return null;
    }
    
    return (
      <div className="delete-dialog-backdrop">
        <div className={`delete-dialog ${dialogClass}`} onKeyDown={this.handleKeyDown}>
          <div className="delete-dialog-header">Delete Conversation</div>
          <div className="delete-dialog-content">
            <p>Are you sure you want to delete "{conversationTitle}"?</p>
            <p>This action cannot be undone.</p>
          </div>
          <div className="delete-dialog-actions">
            <button className="history-button secondary" onClick={onCancel}>
              Cancel
            </button>
            <button 
              ref={this.confirmButtonRef}
              className="history-button danger" 
              onClick={onConfirm}
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default DeleteConfirmationDialog;