import React from 'react';

/**
 * Component to render a loading indicator with animated dots
 */
const LoadingIndicator: React.FC = () => {
  return (
    <div className="loading-indicator">
      <div className="loading-dots">
        <div className="loading-dot"></div>
        <div className="loading-dot"></div>
        <div className="loading-dot"></div>
      </div>
    </div>
  );
};

export default LoadingIndicator;
