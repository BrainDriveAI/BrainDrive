import React from 'react';

interface ChatHeaderProps {
  useStreaming: boolean;
  toggleStreamingMode: () => void;
  isLoading: boolean;
}

/**
 * Component to render the chat header with controls
 */
class ChatHeader extends React.Component<ChatHeaderProps> {
  static defaultProps = {
    useStreaming: true
  };
  render() {
    const { useStreaming, toggleStreamingMode, isLoading } = this.props;
    
    return (
      <div className="chat-header">
        <div className="chat-title">AI Chat v2</div>
        <div className="chat-controls">
          <label className="streaming-toggle">
            <input
              type="checkbox"
              checked={useStreaming}
              onChange={toggleStreamingMode}
              disabled={isLoading}
            />
            <span className="toggle-label">Streaming!</span>
          </label>
        </div>
      </div>
    );
  }
}

export default ChatHeader;
