import { useState, useEffect, useCallback } from 'react';
import { Services, ModelInfo, ChatMessage } from '../types/chat';
import { generateId } from '../utils/formatters';

/**
 * Hook to integrate with the event service for model selection
 * @param eventService The event service from props
 * @param addMessageToChat Function to add a message to the chat
 * @returns The selected model information
 */
export const useEventIntegration = (
  eventService?: Services['event'],
  addMessageToChat?: (message: ChatMessage) => void
) => {
  const [selectedModel, setSelectedModel] = useState<ModelInfo | null>(null);

  // Handler for model selection events
  const handleModelSelection = useCallback((message: any) => {
    console.log('Received message in AIPromptChat:', message);
    
    // Extract model from the message content
    const modelInfo = message.content?.model;
    
    if (modelInfo) {
      // Check if it's a new model
      const isNewModel = !selectedModel || selectedModel.name !== modelInfo.name;
      
      // Update the selected model state
      setSelectedModel(modelInfo);
      console.log('Model selected:', modelInfo);
      
      // Only add a message to the chat history if it's a new model
      // This prevents duplicate messages but ensures the model is always selected
      if (isNewModel && addMessageToChat) {
        addMessageToChat({
          id: generateId('model-selection'),
          sender: 'ai',
          content: `Model selected: ${modelInfo.name}`,
          timestamp: new Date().toISOString()
        });
      } else {
        console.log('Model already selected, updating state but skipping duplicate message');
      }
    }
  }, [selectedModel, addMessageToChat]);

  // Set up event subscription
  useEffect(() => {
    if (!eventService) return;

    try {
      // Subscribe to model selection events
      eventService.subscribeToMessages(
        'ai-prompt-chat', // Use the component's moduleId
        handleModelSelection
      );
      
      console.log('Subscribed to messages for ai-prompt-chat');
      
      // Clean up on unmount
      return () => {
        eventService.unsubscribeFromMessages('ai-prompt-chat', handleModelSelection);
      };
    } catch (error) {
      console.error('Error initializing event service:', error);
    }
  }, [eventService, handleModelSelection]);

  // Function to notify other components about user prompts
  const sendPromptEvent = useCallback((prompt: string) => {
    if (!eventService) return;
    
    eventService.sendMessage('ai.prompt', {
      prompt,
      timestamp: new Date().toISOString()
    });
  }, [eventService]);

  return { selectedModel, sendPromptEvent };
};
