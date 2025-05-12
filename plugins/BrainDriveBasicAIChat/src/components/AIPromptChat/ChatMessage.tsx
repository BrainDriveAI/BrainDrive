import React from 'react';
import { ChatMessage as ChatMessageType } from '../../types/chat';
import { formatTimestamp } from '../../utils/formatters';

interface ChatMessageProps {
  message: ChatMessageType;
}

/**
 * Component to render a single chat message
 */
const ChatMessage: React.FC<ChatMessageProps> = ({ message }) => {
  const { sender, content, timestamp, isStreaming } = message;
  const messageClass = `message message-${sender} ${isStreaming ? 'message-streaming' : ''}`;
  
  return (
    <div className={messageClass}>
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
      <div className="message-timestamp">{formatTimestamp(timestamp)}</div>
    </div>
  );
};

export default ChatMessage;
