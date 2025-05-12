import React from 'react';
import { ComputerIcon } from '../icons';

/**
 * Component to render an empty state when no messages are present
 */
const EmptyState: React.FC = () => {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">
        <ComputerIcon />
      </div>
      <div className="empty-state-text">
        Start a conversation by typing a message below.
      </div>
    </div>
  );
};

export default EmptyState;
