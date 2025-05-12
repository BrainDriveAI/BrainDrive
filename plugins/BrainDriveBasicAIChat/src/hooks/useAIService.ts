import { useState, useCallback } from 'react';
import { Services, ModelInfo } from '../types/chat';
import { extractTextFromData } from '../utils/formatters';

/**
 * Hook to handle AI service communication
 * @param apiService The API service from props
 * @returns Functions and state for AI communication
 */
export const useAIService = (apiService?: Services['api']) => {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  /**
   * Send a prompt to the AI provider
   * @param prompt User's prompt text
   * @param selectedModel Selected model information
   * @param useStreaming Whether to use streaming mode
   * @param onStreamChunk Callback for streaming chunks
   * @param onComplete Callback when request completes
   */
  const sendPromptToAI = useCallback(async (
    prompt: string,
    selectedModel: ModelInfo | null,
    useStreaming: boolean,
    onStreamChunk: (chunk: string) => void,
    onComplete: () => void
  ) => {
    if (!apiService) {
      setError('API service not available');
      return;
    }
    
    // Check if a model is selected
    if (!selectedModel) {
      setError('Please select a model first');
      return;
    }
    
    try {
      // Set loading state
      setIsLoading(true);
      setError('');
      
      // Create chat messages array with user's prompt
      const messages = [
        { role: "user", content: prompt }
      ];
      
      // Define endpoints
      const productionEndpoint = '/api/v1/ai/providers/chat';
      const testEndpoint = '/api/v1/ai/providers/test/ollama/chat';
      
      // Create production request params
      const productionRequestParams = {
        provider: selectedModel.provider || 'ollama',
        settings_id: selectedModel.providerId || 'ollama_servers_settings',
        server_id: selectedModel.serverId || 'server_1538843993_8e87ea7654',
        model: selectedModel.name,
        messages: messages.map(msg => ({
          role: msg.role || 'user',
          content: msg.content
        })),
        params: {
          temperature: 0.7,
          max_tokens: 2048
        },
        stream: useStreaming,
        user_id: 'c308a926-42da-412b-bad2-6969b91972ac'
      };
      
      // Log the model details for debugging
      console.log('Model details for debugging:');
      console.log('- provider:', selectedModel.provider);
      console.log('- providerId:', selectedModel.providerId);
      console.log('- serverId:', selectedModel.serverId);
      console.log('- name:', selectedModel.name);
      
      // Create test request params as fallback
      const testRequestParams = {
        messages: messages,
        model: selectedModel.name,
        stream: useStreaming,
        temperature: 0.7,
        max_tokens: 2048,
        server_url: "http://localhost:11434" // Default Ollama server URL
      };
      
      // Log the production request params for debugging
      console.log('Production request params:', JSON.stringify(productionRequestParams, null, 2));
      
      // Determine which endpoint to use
      const endpoint = productionEndpoint;

      try {
        // Define a function to handle streaming
        const handleStreaming = async (endpointUrl: string, params: any, isProductionEndpoint: boolean) => {
          console.log(`Using postStreaming method for ${isProductionEndpoint ? 'production' : 'test'} endpoint`);
          
          try {
            if (!apiService.postStreaming) {
              throw new Error('postStreaming method not available');
            }
            
            await apiService.postStreaming(
              endpointUrl,
              params,
              (chunk: string) => {
                try {
                  console.log('Received chunk:', chunk.substring(0, 50) + (chunk.length > 50 ? '...' : ''));
                  const data = JSON.parse(chunk);
                  const chunkText = extractTextFromData(data);
                  console.log('Extracted text from chunk:', chunkText ? chunkText.substring(0, 50) + (chunkText.length > 50 ? '...' : '') : 'No text extracted');
                  
                  if (chunkText) {
                    console.log('Updating UI with chunk text');
                    onStreamChunk(chunkText);
                  }
                } catch (error) {
                  console.error('Error processing streaming chunk:', error);
                }
              },
              {
                timeout: 120000
              }
            );
            
            console.log(`${isProductionEndpoint ? 'Production' : 'Test'} streaming request completed successfully`);
            return true;
          } catch (error) {
            console.error(`Error in ${isProductionEndpoint ? 'production' : 'test'} streaming:`, error);
            return false;
          }
        };
        
        // Define a function to handle non-streaming
        const handleNonStreaming = async (endpointUrl: string, params: any, isProductionEndpoint: boolean) => {
          console.log(`Using post method for ${isProductionEndpoint ? 'production' : 'test'} endpoint`);
          
          try {
            if (!apiService.post) {
              throw new Error('post method not available');
            }
            
            const response = await apiService.post(endpointUrl, params, { timeout: 60000 });
            
            const responseData = response.data || response;
            let responseText = extractTextFromData(responseData);
            
            if (responseText) {
              onStreamChunk(responseText);
              console.log(`${isProductionEndpoint ? 'Production' : 'Test'} non-streaming request completed successfully`);
              return true;
            } else {
              console.error(`${isProductionEndpoint ? 'Production' : 'Test'} response had no text`);
              return false;
            }
          } catch (error) {
            console.error(`Error in ${isProductionEndpoint ? 'production' : 'test'} non-streaming:`, error);
            return false;
          }
        };
        
        // Try production endpoint first
        let success = false;
        
        if (useStreaming && typeof apiService.postStreaming === 'function') {
          success = await handleStreaming(productionEndpoint, productionRequestParams, true);
          
          // If production endpoint fails, try test endpoint
          if (!success) {
            console.log('Production endpoint failed, falling back to test endpoint');
            onStreamChunk("Production endpoint failed, trying test endpoint...\n\n");
            success = await handleStreaming(testEndpoint, testRequestParams, false);
          }
        } else {
          success = await handleNonStreaming(productionEndpoint, productionRequestParams, true);
          
          // If production endpoint fails, try test endpoint
          if (!success) {
            console.log('Production endpoint failed, falling back to test endpoint');
            onStreamChunk("Production endpoint failed, trying test endpoint...\n\n");
            success = await handleNonStreaming(testEndpoint, testRequestParams, false);
          }
        }
        
        // If both endpoints failed, show error message
        if (!success) {
          onStreamChunk("Sorry, I couldn't generate a response. Both production and test endpoints failed.");
        }
      } catch (error) {
        console.error('Error getting AI response:', error);
        onStreamChunk("Sorry, I couldn't generate a response. Please try again.");
      } finally {
        // Reset loading state
        setIsLoading(false);
        onComplete();
      }
    } catch (error) {
      console.error('Error in sendPromptToAI:', error);
      setIsLoading(false);
      setError(`Error sending prompt: ${error instanceof Error ? error.message : 'Unknown error'}`);
      onComplete();
    }
  }, [apiService]);

  return {
    isLoading,
    error,
    sendPromptToAI,
    setError
  };
};
