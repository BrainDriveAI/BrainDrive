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
  isLoadingHistory: boolean;
  currentUserId: string | null;
  isInitializing: boolean; // New state to track initialization
}> {
  private chatHistoryRef = React.createRef<HTMLDivElement>();
  private inputRef = React.createRef<HTMLTextAreaElement>();
  private themeChangeListener: ((theme: string) => void) | null = null;
  private modelSelectionListener: ((content: any) => void) | null = null;
  private conversationSelectionListener: ((content: any) => void) | null = null;
  private newChatListener: ((content: any) => void) | null = null;
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
        : props.defaultStreamingMode !== undefined 
          ? !!props.defaultStreamingMode 
          : true,
      conversation_id: null,
      isLoadingHistory: false,
      currentUserId: null, // Add state for current user ID
      isInitializing: true // Start in initializing state
    };
    
    // Bind methods that will be passed as props
    this.formatTimestamp = this.formatTimestamp.bind(this);
  }

  componentDidMount() {
    this.initializeThemeService();
    this.initializeEventService();
    this.getCurrentUserId();
    
    // Set a longer timeout (2 seconds) to finish initialization
    // This gives more time for conversation selection events to be processed
    setTimeout(() => {
      console.log("Initialization timeout completed. Conversation ID:", this.state.conversation_id);
      
      // If we already have a conversation_id, it means loadConversationHistory was called
      // and that method will handle setting isInitializing to false
      if (!this.state.conversation_id) {
        // No conversation was loaded during the initialization period
        
        // Add initial greeting if provided and not already added
        if (this.props.initialGreeting && !this.initialGreetingAdded) {
          this.initialGreetingAdded = true;
          
          // Instead of immediately adding to chat, prepare the message
          const greetingMessage: ChatMessage = {
            id: generateId('greeting'),
            sender: 'ai' as 'ai', // Explicitly type as 'ai'
            content: this.props.initialGreeting,
            timestamp: new Date().toISOString()
          };
          
          // Set state with the greeting message and mark initialization as complete
          this.setState(prevState => ({
            messages: [...prevState.messages, greetingMessage],
            isInitializing: false
          }));
        } else {
          // If no greeting is needed, just mark initialization as complete
          this.setState({ isInitializing: false });
        }
      }
    }, 2000); // Increased to 2 seconds as suggested
  }

  /**
   * Get the current user ID from the API
   */
  async getCurrentUserId() {
    try {
      if (this.props.services?.api) {
        const response = await this.props.services.api.get('/api/v1/auth/me');
        if (response && response.id) {
          this.setState({ currentUserId: response.id });
        }
      }
    } catch (error) {
      // Error getting current user ID
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
    if (this.props.services?.event) {
      if (this.modelSelectionListener) {
        this.props.services.event.unsubscribeFromMessages('ai-prompt-chat', this.modelSelectionListener);
      }
      
      if (this.conversationSelectionListener) {
        this.props.services.event.unsubscribeFromMessages('ai-prompt-chat', this.conversationSelectionListener);
      }
      
      if (this.newChatListener) {
        this.props.services.event.unsubscribeFromMessages('ai-prompt-chat', this.newChatListener);
      }
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
      // Error getting saved streaming mode
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
      // Error saving streaming mode
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
        // Error initializing theme service
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
          // Extract model from the message content
          const modelInfo = message.content?.model;
          
          if (modelInfo) {
            // Check if it's a new model
            const isNewModel = !this.state.selectedModel || this.state.selectedModel.name !== modelInfo.name;
            
            // Update the selected model state
            this.setState({ selectedModel: modelInfo });
            // Only add a message to the chat history if it's a new model
            if (isNewModel) {
              this.addMessageToChat({
                id: generateId('model-selection'),
                sender: 'ai',
                content: `Model selected: ${modelInfo.name}`,
                timestamp: new Date().toISOString()
              });
            } else {
            }
          }
        };
        
        // Set up conversation selection listener
        this.conversationSelectionListener = (message: any) => {
          // Extract conversation ID from the message content
          const conversationId = message.content?.conversation_id;
          
          console.log("Received conversation selection event:", {
            conversationId,
            isInitializing: this.state.isInitializing,
            currentTime: new Date().toISOString()
          });
          
          if (conversationId) {
            // Make sure we stay in initializing state until conversation is loaded
            if (!this.state.isInitializing) {
              this.setState({ isInitializing: true }, () => {
                this.loadConversationHistory(conversationId);
              });
            } else {
              this.loadConversationHistory(conversationId);
            }
          }
        };
        
        // Set up new chat listener
        this.newChatListener = (message: any) => {
          if (message.type === 'conversation.new' || message.content?.type === 'conversation.new') {
            // Clear conversation and show initial greeting (default behavior)
            this.clearConversation(false);
            // Reset the flag to allow showing initial greeting for new conversations
            this.initialGreetingAdded = false;
          }
        };
        
        // Subscribe to messages
        this.props.services.event.subscribeToMessages(
          'ai-prompt-chat',
          this.modelSelectionListener
        );
        
        this.props.services.event.subscribeToMessages(
          'ai-prompt-chat',
          this.conversationSelectionListener
        );
        
        this.props.services.event.subscribeToMessages(
          'ai-prompt-chat',
          this.newChatListener
        );
        
      } catch (error) {
        // Error initializing event service
      }
    }
  }
  
  /**
   * Load conversation history from the API
   */
  async loadConversationHistory(conversationId: string) {
    console.log("Loading conversation history:", {
      conversationId,
      isInitializing: this.state.isInitializing,
      currentTime: new Date().toISOString()
    });
    
    if (!this.props.services?.api) {
      this.setState({ error: 'API service not available', isInitializing: false });
      return;
    }
    
    try {
      // Clear current conversation without showing initial greeting
      this.clearConversation(true);
      
      // Set loading state
      this.setState({ isLoadingHistory: true, error: '' });
      
      // Fetch conversation with messages
      console.log("Fetching conversation messages from API...");
      const response = await this.props.services.api.get(
        `/api/v1/conversations/${conversationId}/with-messages`
      );
      console.log("Received conversation data:", {
        conversationId,
        messageCount: response?.messages?.length || 0
      });
      
      // Mark that we've loaded a conversation, so don't show initial greeting
      this.initialGreetingAdded = true;
      
      // Process messages
      const messages: ChatMessage[] = [];
      
      if (response && response.messages && Array.isArray(response.messages)) {
        // Convert API message format to ChatMessage format
        messages.push(...response.messages.map((msg: any) => ({
          id: msg.id || generateId('history'),
          sender: msg.sender === 'llm' ? 'ai' : 'user' as 'ai' | 'user',
          content: msg.message,
          timestamp: msg.created_at
        })));
      }
      
      // Update state
      this.setState({
        messages,
        conversation_id: conversationId,
        isLoadingHistory: false,
        isInitializing: false // Mark initialization as complete
      });
      
      // Scroll to bottom after loading history
      setTimeout(() => this.scrollToBottom(), 100);
      
    } catch (error) {
      // Error loading conversation history
      this.setState({
        isLoadingHistory: false,
        error: 'Error loading conversation history',
        isInitializing: false // Mark initialization as complete even on error
      });
    }
  }
  
  /**
   * Clear the current conversation
   */
  clearConversation(skipGreeting = false) {
    console.log("Clearing conversation:", {
      skipGreeting,
      isInitializing: this.state.isInitializing,
      currentConversationId: this.state.conversation_id,
      currentTime: new Date().toISOString()
    });
    
    this.setState({
      messages: [],
      conversation_id: null
    });
    
    // Add initial greeting if provided and not explicitly skipped
    if (this.props.initialGreeting && !skipGreeting) {
      console.log("Adding initial greeting after clearing conversation");
      this.initialGreetingAdded = true;
      this.addMessageToChat({
        id: generateId('greeting'),
        sender: 'ai',
        content: this.props.initialGreeting,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Add a new message to the chat history
   */
  addMessageToChat = (message: ChatMessage) => {
    console.log("Adding message to chat:", {
      messageId: message.id,
      sender: message.sender,
      contentPreview: message.content.substring(0, 50) + (message.content.length > 50 ? '...' : ''),
      isInitializing: this.state.isInitializing,
      currentTime: new Date().toISOString()
    });
    
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
        user_id: this.state.currentUserId || 'current', // Use current user ID or 'current' as fallback
        conversation_id: this.state.conversation_id
      };
      
      
      // Create test request params as fallback
      const testRequestParams = {
        messages: messages,
        model: this.state.selectedModel.name,
        stream: useStreaming,
        temperature: 0.7,
        max_tokens: 2048,
        server_url: "http://localhost:11434" // Default Ollama server URL
      };
      
      
      // Determine which endpoint to use
      const endpoint = productionEndpoint;

      try {
        // Define a function to handle streaming
        const handleStreaming = async (endpointUrl: string, params: any, isProductionEndpoint: boolean) => {
          
          try {
            if (!this.props.services?.api?.postStreaming) {
              throw new Error('postStreaming method not available');
            }
            
            await this.props.services.api.postStreaming(
              endpointUrl,
              params,
              (chunk: string) => {
                try {
                  const data = JSON.parse(chunk);
                  
                  // Store the conversation_id if it's in the response
                  if (data.conversation_id && !this.state.conversation_id) {
                    this.setState({ conversation_id: data.conversation_id }, () => {
                      // Broadcast the new conversation to AIChatHistory
                      this.broadcastNewConversationCreated(data.conversation_id);
                    });
                  }
                  
                  const chunkText = extractTextFromData(data);
                  if (chunkText) {
                    this.updateStreamingMessage(placeholderId, chunkText);
                  }
                } catch (error) {
                  // Error processing streaming chunk
                }
              },
              {
                timeout: 120000
              }
            );
            
            return true;
          } catch (error) {
            // Error in streaming
            return false;
          }
        };
        
        // Define a function to handle non-streaming
        const handleNonStreaming = async (endpointUrl: string, params: any, isProductionEndpoint: boolean) => {
          
          try {
            if (!this.props.services?.api?.post) {
              throw new Error('post method not available');
            }
            
            const response = await this.props.services.api.post(endpointUrl, params, { timeout: 60000 });
            
            const responseData = response.data || response;
            
            // Store the conversation_id if it's in the response
            if (responseData.conversation_id && !this.state.conversation_id) {
              this.setState({ conversation_id: responseData.conversation_id }, () => {
                // Broadcast the new conversation to AIChatHistory
                this.broadcastNewConversationCreated(responseData.conversation_id);
              });
            }
            
            let responseText = extractTextFromData(responseData);
            
            if (responseText) {
              this.updateStreamingMessage(placeholderId, responseText);
              return true;
            } else {
              // Response had no text
              return false;
            }
          } catch (error) {
            // Error in non-streaming
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
            this.updateStreamingMessage(placeholderId, "Production endpoint failed, trying test endpoint...\n\n");
            success = await handleStreaming(testEndpoint, testRequestParams, false);
          }
        } else {
          success = await handleNonStreaming(productionEndpoint, productionRequestParams, true);
          
          // Store the conversation_id from the response if available
          // This will be handled in the non-streaming response processing
          
          // If production endpoint fails, try test endpoint
          if (!success) {
            this.updateStreamingMessage(placeholderId, "Production endpoint failed, trying test endpoint...\n\n");
            success = await handleNonStreaming(testEndpoint, testRequestParams, false);
          }
        }
        
        // If both endpoints failed, show error message
        if (!success) {
          this.updateStreamingMessage(placeholderId, "Sorry, I couldn't generate a response. Both production and test endpoints failed.");
        }
      } catch (error) {
        // Error getting AI response
        this.updateStreamingMessage(placeholderId, "Sorry, I couldn't generate a response. Please try again.");
      } finally {
        // Finalize the message and reset loading state
        this.finalizeStreamingMessage(placeholderId);
        this.setState({ isLoading: false });
      }
    } catch (error) {
      // Error in sendPromptToAI
      this.setState({ 
        isLoading: false,
        error: `Error sending prompt: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    }
  }

  /**
   * Broadcast new conversation created event to AIChatHistory
   */
  broadcastNewConversationCreated(conversationId: string) {
    if (!this.props.services?.event) {
      // Event service not available
      return;
    }
    
    // Create message with conversation_id directly at the top level
    // This matches the format that AIChatHistory receives after transformation
    const message = {
      conversation_id: conversationId,
      timestamp: new Date().toISOString()
    };
    
    // Send to AIChatHistory
    
    this.props.services.event.sendMessage('ai-chat-history', message);
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
   * Render initializing state
   */
  renderInitializingState() {
    if (!this.state.isInitializing) return null;
    
    return (
      <div className="loading-indicator">
        <div className="loading-dots">
          <div className="loading-dot"></div>
          <div className="loading-dot"></div>
          <div className="loading-dot"></div>
        </div>
        <div className="loading-text">
          Initializing chat...
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
    const { inputText, messages, isLoading, isLoadingHistory, useStreaming, error, isInitializing } = this.state;
    const { promptQuestion } = this.props;
    const themeClass = this.state.currentTheme === 'dark' ? 'dark-theme' : '';
    
    return (
      <div className={`ai-chat-container ${themeClass}`}>
        <div className="ai-chat-paper">
          {/* Use ChatHeader component */}
          <ChatHeader
            useStreaming={useStreaming}
            toggleStreamingMode={this.toggleStreamingMode}
            isLoading={isLoading || isLoadingHistory}
          />
          
          {/* Show initializing state or chat content */}
          {isInitializing ? (
            // Show initializing state
            this.renderInitializingState()
          ) : (
            // Show chat content only when initialization is complete
            <>
              {/* Use ChatHistory component */}
              <ChatHistory
                messages={messages}
                isLoading={isLoading || isLoadingHistory}
                error={error}
                chatHistoryRef={this.chatHistoryRef}
                formatTimestamp={this.formatTimestamp}
              />
              
              {/* Use ChatInput component */}
              <ChatInput
                inputText={inputText}
                isLoading={isLoading || isLoadingHistory}
                promptQuestion={promptQuestion}
                onInputChange={this.handleInputChange}
                onKeyPress={this.handleKeyPress}
                onSendMessage={this.handleSendMessage}
                inputRef={this.inputRef}
              />
            </>
          )}
        </div>
      </div>
    );
  }
}

// Add version information for debugging and tracking
(AIPromptChat as any).version = '2.0.0';

export default AIPromptChat;
