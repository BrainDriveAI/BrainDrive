import React from 'react';
import { LightningIcon } from '../icons';

interface ChatInputProps {
  inputText: string;
  isLoading: boolean;
  promptQuestion?: string;
  onInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyPress: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSendMessage: () => void;
  inputRef: React.RefObject<HTMLTextAreaElement>;
}

/**
 * Component to render the chat input area
 */
class ChatInput extends React.Component<ChatInputProps> {
  render() {
    const { 
      inputText, 
      isLoading, 
      promptQuestion, 
      onInputChange, 
      onKeyPress, 
      onSendMessage,
      inputRef
    } = this.props;
    
    return (
      <div className="chat-input-container">
        <div className="chat-input-wrapper">
          <textarea
            ref={inputRef}
            className="chat-input"
            value={inputText}
            onChange={onInputChange}
            onKeyDown={onKeyPress}
            placeholder={promptQuestion || "Type your message here..."}
            rows={1}
          />
          <button
            className="send-button"
            onClick={onSendMessage}
            disabled={!inputText.trim() || isLoading}
            aria-label="Send message"
          >
            <LightningIcon />
          </button>
        </div>
      </div>
    );
  }
}

export default ChatInput;
