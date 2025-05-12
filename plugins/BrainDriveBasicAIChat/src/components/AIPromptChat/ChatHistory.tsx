import React from 'react';
import { ChatMessage as ChatMessageType } from '../../types/chat';

interface ChatHistoryProps {
  messages: ChatMessageType[];
  isLoading: boolean;
  error: string;
  chatHistoryRef: React.RefObject<HTMLDivElement>;
  formatTimestamp: (timestamp: string) => string;
}

/**
 * Component to render the chat history with messages
 */
class ChatHistory extends React.Component<ChatHistoryProps> {
  /**
   * Render a chat message
   */
  renderMessage(message: ChatMessageType) {
    const { sender, content, timestamp, isStreaming } = message;
    const messageClass = `message message-${sender} ${isStreaming ? 'message-streaming' : ''}`;
    
    return (
      <div key={message.id} className={messageClass}>
        <div className="message-content">
          {content}
          {/* Only show typing indicator when content is empty and message is still streaming */}
          {isStreaming && content.length === 0 && (
            <span className="typing-indicator">
              <span className="typing-dot"></span>
              <span className="typing-dot"></span>
              <span className="typing-dot"></span>
            </span>
          )}
        </div>
        <div className="message-timestamp">{this.props.formatTimestamp(timestamp)}</div>
      </div>
    );
  }

  /**
   * Render loading indicator
   */
  renderLoadingIndicator() {
    return (
      <div className="loading-indicator">
        <div className="loading-dots">
          <div className="loading-dot"></div>
          <div className="loading-dot"></div>
          <div className="loading-dot"></div>
        </div>
      </div>
    );
  }

  /**
   * Render error message
   */
  renderError() {
    if (!this.props.error) return null;
    
    return (
      <div className="error-message">
        {this.props.error}
      </div>
    );
  }

  /**
   * Render empty state when no messages
   */
  renderEmptyState() {
    if (this.props.messages.length > 0) return null;
    
    return (
      <div className="empty-state">
        <div className="empty-state-icon">
          {/* ComputerIcon will be passed as a child component */}
          <svg 
            xmlns="http://www.w3.org/2000/svg" 
            width="24" 
            height="24" 
            viewBox="0 0 24 24" 
            fill="none" 
            stroke="currentColor" 
            strokeWidth="2" 
            strokeLinecap="round" 
            strokeLinejoin="round"
          >
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
        </div>
        <div className="empty-state-text">
          Start a conversation by typing a message below.
        </div>
      </div>
    );
  }

  render() {
    const { messages, isLoading, chatHistoryRef } = this.props;
    
    return (
      <div className="chat-history" ref={chatHistoryRef}>
        {this.renderEmptyState()}
        {messages.map(message => this.renderMessage(message))}
        {isLoading && this.renderLoadingIndicator()}
        {this.renderError()}
      </div>
    );
  }
}

export default ChatHistory;
