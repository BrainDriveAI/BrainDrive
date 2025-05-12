import { useState, useRef, useCallback } from 'react';
import { ChatMessage } from '../types/chat';
import { generateId } from '../utils/formatters';

/**
 * Hook to manage chat messages
 * @param initialGreeting Optional initial greeting message
 * @returns Chat messages state and operations
 */
export const useChatMessages = (initialGreeting?: string) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const chatHistoryRef = useRef<HTMLDivElement>(null);
  const initialGreetingAdded = useRef<boolean>(false);

  // Add initial greeting if provided
  const addInitialGreeting = useCallback(() => {
    if (initialGreeting && !initialGreetingAdded.current) {
      initialGreetingAdded.current = true;
      addMessageToChat({
        id: generateId('greeting'),
        sender: 'ai',
        content: initialGreeting,
        timestamp: new Date().toISOString()
      });
      console.log('Initial greeting added');
    }
  }, [initialGreeting]);

  // Add a new message to the chat
  const addMessageToChat = useCallback((message: ChatMessage) => {
    setMessages(prevMessages => [...prevMessages, message]);
  }, []);

  // Update a streaming message with new content
  const updateStreamingMessage = useCallback((messageId: string, newContent: string) => {
    setMessages(prevMessages => {
      // Find the message to update
      const messageToUpdate = prevMessages.find(m => m.id === messageId);
      
      // If message not found, return unchanged state
      if (!messageToUpdate) return prevMessages;
      
      // Create a new messages array with the updated message
      return prevMessages.map(message => {
        if (message.id === messageId) {
          return {
            ...message,
            content: message.content + newContent
          };
        }
        return message;
      });
    });
    
    // After state update, scroll to bottom
    scrollToBottom();
  }, []);

  // Finalize a streaming message (mark as no longer streaming)
  const finalizeStreamingMessage = useCallback((messageId: string) => {
    setMessages(prevMessages => 
      prevMessages.map(message => {
        if (message.id === messageId) {
          return {
            ...message,
            isStreaming: false
          };
        }
        return message;
      })
    );
    
    // After state update, scroll to bottom
    scrollToBottom();
  }, []);

  // Scroll the chat history to the bottom
  const scrollToBottom = useCallback(() => {
    if (chatHistoryRef.current) {
      chatHistoryRef.current.scrollTop = chatHistoryRef.current.scrollHeight;
    }
  }, []);

  // Create a placeholder for AI response
  const createAIResponsePlaceholder = useCallback(() => {
    const placeholderId = generateId('ai');
    
    addMessageToChat({
      id: placeholderId,
      sender: 'ai',
      content: '',
      timestamp: new Date().toISOString(),
      isStreaming: true
    });
    
    return placeholderId;
  }, [addMessageToChat]);

  return {
    messages,
    chatHistoryRef,
    addInitialGreeting,
    addMessageToChat,
    updateStreamingMessage,
    finalizeStreamingMessage,
    scrollToBottom,
    createAIResponsePlaceholder
  };
};
