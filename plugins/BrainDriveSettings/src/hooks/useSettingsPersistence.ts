import { useState, useEffect, useCallback } from 'react';
import { Services, ChatMessage } from '../types/chat';
import { generateId } from '../utils/formatters';

// Key for storing streaming mode setting
const STREAMING_SETTING_KEY = 'ai_prompt_chat_streaming_enabled';

/**
 * Hook to manage settings persistence
 * @param settingsService The settings service from props
 * @param defaultStreamingMode Default streaming mode from props
 * @param addMessageToChat Function to add a message to the chat
 * @returns Streaming mode state and toggle function
 */
export const useSettingsPersistence = (
  settingsService?: Services['settings'],
  defaultStreamingMode: boolean = false,
  addMessageToChat?: (message: ChatMessage) => void
) => {
  const [useStreaming, setUseStreaming] = useState<boolean>(defaultStreamingMode);

  // Load saved streaming mode on mount
  useEffect(() => {
    const savedStreamingMode = getSavedStreamingMode();
    if (savedStreamingMode !== null) {
      setUseStreaming(savedStreamingMode);
    }
  }, []);

  // Get saved streaming mode from settings
  const getSavedStreamingMode = (): boolean | null => {
    try {
      if (settingsService) {
        const savedValue = settingsService.get(STREAMING_SETTING_KEY);
        if (typeof savedValue === 'boolean') {
          return savedValue;
        }
      }
      return null;
    } catch (error) {
      console.error('Error getting saved streaming mode:', error);
      return null;
    }
  };

  // Save streaming mode to settings
  const saveStreamingMode = async (enabled: boolean): Promise<void> => {
    try {
      if (settingsService) {
        await settingsService.set(STREAMING_SETTING_KEY, enabled);
      }
    } catch (error) {
      console.error('Error saving streaming mode:', error);
    }
  };

  // Toggle streaming mode
  const toggleStreamingMode = useCallback(async () => {
    const newStreamingMode = !useStreaming;
    setUseStreaming(newStreamingMode);
    await saveStreamingMode(newStreamingMode);
    
    // Add a message to the chat history indicating the mode change
    if (addMessageToChat) {
      addMessageToChat({
        id: generateId('streaming-mode'),
        sender: 'ai',
        content: `Streaming mode ${newStreamingMode ? 'enabled' : 'disabled'}`,
        timestamp: new Date().toISOString()
      });
    }
  }, [useStreaming, addMessageToChat]);

  return { useStreaming, toggleStreamingMode };
};
