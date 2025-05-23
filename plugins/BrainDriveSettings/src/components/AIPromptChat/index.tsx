import React from 'react';
import './AIPromptChat.css';
import { AIPromptChatProps, ChatMessage, ModelInfo } from '../../types/chat';
import { generateId, extractTextFromData } from '../../utils/formatters';
import { ComputerIcon, LightningIcon } from '../icons';

// Import modular components
import ChatHeader from './ChatHeader';
import ChatHistory from './ChatHistory';
import ChatInput from './ChatInput';

/**
 * Main AIPromptChat component using class-based approach for remote plugin compatibility
 */
class AIPromptChat extends React.Component<AIPromptChatProps, {
  messages: ChatMessage[];
  inputText: string;
  isLoading: boolean;
  error: string;
  currentTheme: string;
  selectedModel: ModelInfo | null;
  useStreaming: boolean;
  conversation_id: string | null;
}> {
  private chatHistoryRef = React.createRef<HTMLDivElement>();
  private inputRef = React.createRef<HTMLTextAreaElement>();
  private themeChangeListener: ((theme: string) => void) | null = null;
  private modelSelectionListener: ((content: any) => void) | null = null;
  private readonly STREAMING_SETTING_KEY = 'ai_prompt_chat_streaming_enabled';
  private initialGreetingAdded = false;

  constructor(props: AIPromptChatProps) {
    super(props);
    
    // Initialize streaming mode from settings or props
    const savedStreamingMode = this.getSavedStreamingMode();
    
    this.state = {
      messages: [],
      inputText: '',
      isLoading: false,
      error: '',
      currentTheme: 'light', // Default theme
      selectedModel: null,
      useStreaming: savedStreamingMode !== null
        ? savedStreamingMode
        : !!props.defaultStreamingMode,
      conversation_id: null
    };
    
    // Bind methods that will be passed as props
    this.formatTimestamp = this.formatTimestamp.bind(this);
  }

  componentDidMount() {
    this.initializeThemeService();
    this.initializeEventService();
    
    // Add initial greeting if provided and not already added
    if (this.props.initialGreeting && !this.initialGreetingAdded) {
      this.initialGreetingAdded = true;
      this.addMessageToChat({
        id: generateId('greeting'),
        sender: 'ai',
        content: this.props.initialGreeting,
        timestamp: new Date().toISOString()
      });
      console.log('Initial greeting added');
    }
  }

  componentDidUpdate(prevProps: AIPromptChatProps, prevState: typeof this.state) {
    // Scroll to bottom when new messages are added
    if (prevState.messages.length !== this.state.messages.length) {
      this.scrollToBottom();
    }
  }

  componentWillUnmount() {
    // Clean up theme listener
    if (this.themeChangeListener && this.props.services?.theme) {
      this.props.services.theme.removeThemeChangeListener(this.themeChangeListener);
    }
    
    // Clean up event listeners
    if (this.modelSelectionListener && this.props.services?.event) {
      this.props.services.event.unsubscribeFromMessages('ai-prompt-chat', this.modelSelectionListener);
    }
  }

  /**
   * Get saved streaming mode from settings
   */
  getSavedStreamingMode(): boolean | null {
    try {
      if (this.props.services?.settings) {
        const savedValue = this.props.services.settings.get(this.STREAMING_SETTING_KEY);
        if (typeof savedValue === 'boolean') {
          return savedValue;
        }
      }
      return null;
    } catch (error) {
      console.error('Error getting saved streaming mode:', error);
      return null;
    }
  }

  /**
   * Save streaming mode to settings
   */
  async saveStreamingMode(enabled: boolean): Promise<void> {
    try {
      if (this.props.services?.settings) {
        await this.props.services.settings.set(this.STREAMING_SETTING_KEY, enabled);
      }
    } catch (error) {
      console.error('Error saving streaming mode:', error);
    }
  }

  /**
   * Toggle streaming mode
   */
  toggleStreamingMode = async () => {
    const newStreamingMode = !this.state.useStreaming;
    this.setState({ useStreaming: newStreamingMode });
    await this.saveStreamingMode(newStreamingMode);
    
    // Add a message to the chat history indicating the mode change
    this.addMessageToChat({
      id: generateId('streaming-mode'),
      sender: 'ai',
      content: `Streaming mode ${newStreamingMode ? 'enabled' : 'disabled'}`,
      timestamp: new Date().toISOString()
    });
  };

  /**
   * Initialize the theme service to listen for theme changes
   */
  initializeThemeService() {
    if (this.props.services?.theme) {
      try {
        // Get the current theme
        const currentTheme = this.props.services.theme.getCurrentTheme();
        this.setState({ currentTheme });
        
        // Set up theme change listener
        this.themeChangeListener = (newTheme: string) => {
          this.setState({ currentTheme: newTheme });
        };
        
        // Add the listener to the theme service
        this.props.services.theme.addThemeChangeListener(this.themeChangeListener);
      } catch (error) {
        console.error('Error initializing theme service:', error);
      }
    }
  }

  /**
   * Initialize the event service to listen for model selection events
   */
  initializeEventService() {
    if (this.props.services?.event) {
      try {
        // Set up model selection listener
        this.modelSelectionListener = (message: any) => {
          console.log('Received message in AIPromptChat:', message);
          
          // Extract model from the message content
          const modelInfo = message.content?.model;
          
          if (modelInfo) {
            // Check if it's a new model
            const isNewModel = !this.state.selectedModel || this.state.selectedModel.name !== modelInfo.name;
            
            // Update the selected model state
            this.setState({ selectedModel: modelInfo });
            console.log('Model selected:', modelInfo);
            
            // Only add a message to the chat history if it's a new model
            if (isNewModel) {
              this.addMessageToChat({
                id: generateId('model-selection'),
                sender: 'ai',
                content: `Model selected: ${modelInfo.name}`,
                timestamp: new Date().toISOString()
              });
            } else {
              console.log('Model already selected, updating state but skipping duplicate message');
            }
          }
        };
        
        // Subscribe to model selection events
        this.props.services.event.subscribeToMessages(
          'ai-prompt-chat',
          this.modelSelectionListener
        );
        
        console.log('Subscribed to messages for ai-prompt-chat');
      } catch (error) {
        console.error('Error initializing event service:', error);
      }
    }
  }

  /**
   * Add a new message to the chat history
   */
  addMessageToChat = (message: ChatMessage) => {
    this.setState(prevState => ({
      messages: [...prevState.messages, message]
    }));
  }

  /**
   * Create a placeholder for AI response
   */
  createAIResponsePlaceholder = () => {
    const placeholderId = generateId('ai');
    
    this.addMessageToChat({
      id: placeholderId,
      sender: 'ai',
      content: '',
      timestamp: new Date().toISOString(),
      isStreaming: true
    });
    
    return placeholderId;
  }

  /**
   * Update a streaming message with new content
   */
  updateStreamingMessage = (messageId: string, newContent: string) => {
    this.setState(prevState => {
      // Find the message to update
      const messageToUpdate = prevState.messages.find(m => m.id === messageId);
      
      // If message not found, return unchanged state
      if (!messageToUpdate) return prevState;
      
      // Create a new messages array with the updated message
      const updatedMessages = prevState.messages.map(message => {
        if (message.id === messageId) {
          return {
            ...message,
            content: message.content + newContent
          };
        }
        return message;
      });
      
      return {
        ...prevState,
        messages: updatedMessages
      };
    }, () => {
      // After state update, scroll to bottom
      this.scrollToBottom();
    });
  }

  /**
   * Finalize a streaming message (mark as no longer streaming)
   */
  finalizeStreamingMessage = (messageId: string) => {
    this.setState(prevState => ({
      messages: prevState.messages.map(message => {
        if (message.id === messageId) {
          return {
            ...message,
            isStreaming: false
          };
        }
        return message;
      })
    }), () => {
      // After state update, scroll to bottom
      this.scrollToBottom();
    });
  }

  /**
   * Scroll the chat history to the bottom
   */
  scrollToBottom = () => {
    if (this.chatHistoryRef.current) {
      this.chatHistoryRef.current.scrollTop = this.chatHistoryRef.current.scrollHeight;
    }
  }

  /**
   * Handle input change
   */
  handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    this.setState({ inputText: e.target.value });
    
    // Auto-resize the textarea
    if (this.inputRef.current) {
      this.inputRef.current.style.height = 'auto';
      this.inputRef.current.style.height = `${Math.min(this.inputRef.current.scrollHeight, 150)}px`;
    }
  };

  /**
   * Handle key press in the input field
   */
  handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Send message on Enter (without Shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.handleSendMessage();
    }
  };

  /**
   * Handle sending a message
   */
  handleSendMessage = () => {
    const { inputText } = this.state;
    
    // Don't send empty messages
    if (!inputText.trim() || this.state.isLoading) return;
    
    // Add user message to chat
    const userMessage: ChatMessage = {
      id: generateId('user'),
      sender: 'user',
      content: inputText.trim(),
      timestamp: new Date().toISOString()
    };
    
    this.addMessageToChat(userMessage);
    
    // Clear input
    this.setState({ inputText: '' });
    
    // Reset textarea height
    if (this.inputRef.current) {
      this.inputRef.current.style.height = 'auto';
    }
    
    // Send to AI and get response
    this.sendPromptToAI(userMessage.content);
    
    // Notify other components via event service
    if (this.props.services?.event) {
      this.props.services.event.sendMessage('ai.prompt', {
        prompt: userMessage.content,
        timestamp: userMessage.timestamp
      });
    }
  };

  /**
   * Send prompt to AI provider and handle response
   */
  async sendPromptToAI(prompt: string) {
    if (!this.props.services?.api) {
      this.setState({ error: 'API service not available' });
      return;
    }
    
    // Check if a model is selected
    if (!this.state.selectedModel) {
      this.setState({ error: 'Please select a model first' });
      return;
    }
    
    try {
      // Set loading state
      this.setState({ isLoading: true, error: '' });
      
      // Create placeholder for AI response
      const placeholderId = this.createAIResponsePlaceholder();
      
      // Get streaming mode from state
      const useStreaming = this.state.useStreaming;
      
      // Create chat messages array with user's prompt
      const messages = [
        { role: "user", content: prompt }
      ];
      
      // Define endpoints
      const productionEndpoint = '/api/v1/ai/providers/chat';
      const testEndpoint = '/api/v1/ai/providers/test/ollama/chat';
      
      // Create production request params
      const productionRequestParams = {
        provider: this.state.selectedModel.provider || 'ollama',
        settings_id: this.state.selectedModel.providerId || 'ollama_servers_settings',
        server_id: this.state.selectedModel.serverId || 'server_1538843993_8e87ea7654',
        model: this.state.selectedModel.name,
        messages: messages.map(msg => ({
          role: msg.role || 'user',
          content: msg.content
        })),
        params: {
          temperature: 0.7,
          max_tokens: 2048
        },
        stream: useStreaming,
        user_id: 'c308a926-42da-412b-bad2-6969b91972ac',
        conversation_id: this.state.conversation_id
      };
      
      // Log the model details for debugging
      console.log('Model details for debugging:');
      console.log('- provider:', this.state.selectedModel.provider);
      console.log('- providerId:', this.state.selectedModel.providerId);
      console.log('- serverId:', this.state.selectedModel.serverId);
      console.log('- name:', this.state.selectedModel.name);
      
      // Create test request params as fallback
      const testRequestParams = {
        messages: messages,
        model: this.state.selectedModel.name,
        stream: useStreaming,
        temperature: 0.7,
        max_tokens: 2048,
        server_url: "http://localhost:11434" // Default Ollama server URL
      };
      
      // Log the production request params for debugging
      console.log('Production request params:', JSON.stringify(productionRequestParams, null, 2));
      console.log('Using conversation_id:', this.state.conversation_id);
      
      // Determine which endpoint to use
      const endpoint = productionEndpoint;

      try {
        // Define a function to handle streaming
        const handleStreaming = async (endpointUrl: string, params: any, isProductionEndpoint: boolean) => {
          console.log(`Using postStreaming method for ${isProductionEndpoint ? 'production' : 'test'} endpoint`);
          
          try {
            if (!this.props.services?.api?.postStreaming) {
              throw new Error('postStreaming method not available');
            }
            
            await this.props.services.api.postStreaming(
              endpointUrl,
              params,
              (chunk: string) => {
                try {
                  console.log('Received chunk:', chunk.substring(0, 50) + (chunk.length > 50 ? '...' : ''));
                  const data = JSON.parse(chunk);
                  
                  // Store the conversation_id if it's in the response
                  if (data.conversation_id && !this.state.conversation_id) {
                    console.log('Storing conversation_id from chunk:', data.conversation_id);
                    this.setState({ conversation_id: data.conversation_id });
                  }
                  
                  const chunkText = extractTextFromData(data);
                  console.log('Extracted text from chunk:', chunkText ? chunkText.substring(0, 50) + (chunkText.length > 50 ? '...' : '') : 'No text extracted');
                  
                  if (chunkText) {
                    console.log('Updating UI with chunk text');
                    this.updateStreamingMessage(placeholderId, chunkText);
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
            if (!this.props.services?.api?.post) {
              throw new Error('post method not available');
            }
            
            const response = await this.props.services.api.post(endpointUrl, params, { timeout: 60000 });
            
            const responseData = response.data || response;
            
            // Store the conversation_id if it's in the response
            if (responseData.conversation_id && !this.state.conversation_id) {
              console.log('Storing conversation_id:', responseData.conversation_id);
              this.setState({ conversation_id: responseData.conversation_id });
            }
            
            let responseText = extractTextFromData(responseData);
            
            if (responseText) {
              this.updateStreamingMessage(placeholderId, responseText);
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
        
        if (useStreaming && typeof this.props.services.api.postStreaming === 'function') {
          success = await handleStreaming(productionEndpoint, productionRequestParams, true);
          
          // Store the conversation_id from the response if available
          // This will be handled in the streaming response processing
          
          // If production endpoint fails, try test endpoint
          if (!success) {
            console.log('Production endpoint failed, falling back to test endpoint');
            this.updateStreamingMessage(placeholderId, "Production endpoint failed, trying test endpoint...\n\n");
            success = await handleStreaming(testEndpoint, testRequestParams, false);
          }
        } else {
          success = await handleNonStreaming(productionEndpoint, productionRequestParams, true);
          
          // Store the conversation_id from the response if available
          // This will be handled in the non-streaming response processing
          
          // If production endpoint fails, try test endpoint
          if (!success) {
            console.log('Production endpoint failed, falling back to test endpoint');
            this.updateStreamingMessage(placeholderId, "Production endpoint failed, trying test endpoint...\n\n");
            success = await handleNonStreaming(testEndpoint, testRequestParams, false);
          }
        }
        
        // If both endpoints failed, show error message
        if (!success) {
          this.updateStreamingMessage(placeholderId, "Sorry, I couldn't generate a response. Both production and test endpoints failed.");
        }
      } catch (error) {
        console.error('Error getting AI response:', error);
        this.updateStreamingMessage(placeholderId, "Sorry, I couldn't generate a response. Please try again.");
      } finally {
        // Finalize the message and reset loading state
        this.finalizeStreamingMessage(placeholderId);
        this.setState({ isLoading: false });
      }
    } catch (error) {
      console.error('Error in sendPromptToAI:', error);
      this.setState({ 
        isLoading: false,
        error: `Error sending prompt: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    }
  }

  /**
   * Format timestamp for display
   */
  formatTimestamp(timestamp: string) {
    try {
      const date = new Date(timestamp);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (error) {
      return '';
    }
  }

  /**
   * Render a chat message
   */
  renderMessage(message: ChatMessage) {
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
        <div className="message-timestamp">{this.formatTimestamp(timestamp)}</div>
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
    if (!this.state.error) return null;
    
    return (
      <div className="error-message">
        {this.state.error}
      </div>
    );
  }

  /**
   * Render empty state when no messages
   */
  renderEmptyState() {
    if (this.state.messages.length > 0) return null;
    
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
  }

  render() {
    const { inputText, messages, isLoading, useStreaming, error } = this.state;
    const { promptQuestion } = this.props;
    const themeClass = this.state.currentTheme === 'dark' ? 'dark-theme' : '';
    
    return (
      <div className={`ai-chat-container ${themeClass}`}>
        <div className="ai-chat-paper">
          {/* Use ChatHeader component */}
          <ChatHeader 
            useStreaming={useStreaming} 
            toggleStreamingMode={this.toggleStreamingMode} 
            isLoading={isLoading} 
          />
          
          {/* Use ChatHistory component */}
          <ChatHistory 
            messages={messages} 
            isLoading={isLoading} 
            error={error} 
            chatHistoryRef={this.chatHistoryRef}
            formatTimestamp={this.formatTimestamp}
          />
          
          {/* Use ChatInput component */}
          <ChatInput 
            inputText={inputText}
            isLoading={isLoading}
            promptQuestion={promptQuestion}
            onInputChange={this.handleInputChange}
            onKeyPress={this.handleKeyPress}
            onSendMessage={this.handleSendMessage}
            inputRef={this.inputRef}
          />
        </div>
      </div>
    );
  }
}

// Add version information for debugging and tracking
(AIPromptChat as any).version = '2.0.0';

export default AIPromptChat;
