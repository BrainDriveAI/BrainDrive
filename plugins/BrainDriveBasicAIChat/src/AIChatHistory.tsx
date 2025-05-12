import React from 'react';
import './AIChatHistory.css';
import CustomDropdown from './CustomDropdown';
import RenameDialog from './components/RenameDialog';
import DeleteConfirmationDialog from './components/DeleteConfirmationDialog';
import { formatRelativeTime } from './utils/dateFormatters';
import { ModelInfo } from './types/chat';
import { ConversationInfo, ConversationDropdownOption } from './types/conversation';
import { PlusIcon, PencilIcon, TrashIcon } from './icons';

// Define the component props
interface AIChatHistoryProps {
  moduleId?: string;
  label?: string;
  services?: {
    api?: {
      get: (url: string, options?: any) => Promise<any>;
      post: (url: string, data: any) => Promise<any>;
      put: (url: string, data: any) => Promise<any>;
      delete: (url: string, options?: any) => Promise<any>;
    };
    settings?: {
      getSetting: (id: string) => Promise<any>;
      setSetting: (id: string, value: any) => Promise<any>;
      getSettingDefinitions: () => Promise<any>;
    };
    event?: {
      sendMessage: (target: string, message: any, options?: any) => void;
      subscribeToMessages: (target: string, callback: (message: any) => void) => void;
      unsubscribeFromMessages: (target: string, callback: (message: any) => void) => void;
    };
    theme?: {
      getCurrentTheme: () => string;
      addThemeChangeListener: (callback: (theme: string) => void) => void;
      removeThemeChangeListener: (callback: (theme: string) => void) => void;
    };
  };
}

// Define the component state
interface AIChatHistoryState {
  conversations: ConversationInfo[];
  selectedConversation: ConversationInfo | null;
  isLoading: boolean;
  isUpdating: boolean;
  error: string | null;
  currentTheme: 'light' | 'dark';
  isRenameDialogOpen: boolean;
  isDeleteDialogOpen: boolean;
  dropdownOptions: ConversationDropdownOption[];
}

class AIChatHistory extends React.Component<AIChatHistoryProps, AIChatHistoryState> {
  private eventService: any;
  private themeChangeListener: ((theme: string) => void) | null = null;
  private modelSelectionListener: ((message: any) => void) | null = null;
  private newConversationListener: ((message: any) => void) | null = null;
  
  constructor(props: AIChatHistoryProps) {
    super(props);
    
    this.state = {
      conversations: [],
      selectedConversation: null,
      isLoading: true,
      isUpdating: false,
      error: null,
      currentTheme: 'light',
      isRenameDialogOpen: false,
      isDeleteDialogOpen: false,
      dropdownOptions: []
    };
    
    // Initialize event service
    if (props.services?.event) {
      const { createEventService } = require('./services/eventService');
      this.eventService = createEventService('pluginA', props.moduleId || 'ai-chat-history');
      this.eventService.setServiceBridge(props.services.event);
    }
  }
  
  componentDidMount() {
    this.initializeThemeService();
    this.initializeEventService();
    this.fetchConversations();
  }
  
  componentWillUnmount() {
    if (this.themeChangeListener && this.props.services?.theme) {
      this.props.services.theme.removeThemeChangeListener(this.themeChangeListener);
    }
    
    if (this.modelSelectionListener && this.props.services?.event) {
      this.props.services.event.unsubscribeFromMessages(
        'ai-chat-history',
        this.modelSelectionListener
      );
    }
    
    if (this.newConversationListener && this.props.services?.event) {
      this.props.services.event.unsubscribeFromMessages(
        'ai-chat-history',
        this.newConversationListener
      );
    }
  }
  
  /**
   * Initialize the theme service to listen for theme changes
   */
  initializeThemeService() {
    if (this.props.services?.theme) {
      try {
        // Get the current theme
        const currentTheme = this.props.services.theme.getCurrentTheme();
        this.setState({ currentTheme: currentTheme as 'light' | 'dark' });
        
        // Set up theme change listener
        this.themeChangeListener = (newTheme: string) => {
          this.setState({ currentTheme: newTheme as 'light' | 'dark' });
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
          // Handle model selection events
          if (message.type === 'model.selection' && message.content?.model) {
            // Could update the selected conversation's model if needed
          }
        };
        
        // Set up new conversation listener
        this.newConversationListener = (message: any) => {
          // Handle new conversation created events
          // Check for conversation_id directly in the message or in message.content
          const conversationId = message.conversation_id || message.content?.conversation_id;
          
          if (conversationId) {
            // Implement a retry mechanism with delay to handle potential database/API delays
            const attemptToFindAndSelectConversation = (retryCount = 0, maxRetries = 3) => {
              // Refresh the conversation list
              this.fetchConversations().then((conversations) => {
                // After fetching, find the new conversation
                if (this.state.conversations.length > 0) {
                  const newConversation = this.state.conversations.find(conv => conv.id === conversationId);
                  
                  if (newConversation) {
                    
                    // Directly update the selectedConversation state and broadcast the selection
                    this.setState({
                      selectedConversation: newConversation
                    }, () => {
                      // Broadcast the selection to other components
                      this.broadcastConversationSelection(newConversation);
                      
                      // Force update dropdown selection
                      const dropdownElement = document.querySelector('.custom-dropdown-select') as HTMLSelectElement;
                      if (dropdownElement) {
                        dropdownElement.value = conversationId;
                      }
                    });
                  } else {
                    // If we haven't reached max retries, try again after a delay
                    if (retryCount < maxRetries) {
                      setTimeout(() => attemptToFindAndSelectConversation(retryCount + 1, maxRetries), 1000);
                    } else {
                      // As a last resort, try to force a refresh and selection
                      
                      // Try to directly select the conversation by ID even if we can't find it in our list
                      this.handleConversationSelect(conversationId);
                    }
                  }
                } else {
                  // If we haven't reached max retries, try again after a delay
                  if (retryCount < maxRetries) {
                    setTimeout(() => attemptToFindAndSelectConversation(retryCount + 1, maxRetries), 1000);
                  }
                }
              }).catch(error => {
                // If we haven't reached max retries, try again after a delay
                if (retryCount < maxRetries) {
                  setTimeout(() => attemptToFindAndSelectConversation(retryCount + 1, maxRetries), 1000);
                }
              });
            };
            
            // Start the retry process
            attemptToFindAndSelectConversation();
          }
        };
        
        // Subscribe to messages
        this.props.services.event.subscribeToMessages(
          'ai-chat-history',
          this.modelSelectionListener
        );
        
        this.props.services.event.subscribeToMessages(
          'ai-chat-history',
          this.newConversationListener
        );
        
      } catch (error) {
        // Error initializing event service
      }
    }
  }
  
  /**
   * Fetch conversations from the API
   */
  async fetchConversations() {
    if (!this.props.services?.api) {
      this.setState({
        isLoading: false,
        error: 'API service not available'
      });
      return;
    }
    
    try {
      this.setState({ isLoading: true, error: null });
      
      // First, get the current user's information to get their ID
      const userResponse = await this.props.services.api.get('/api/v1/auth/me');
      
      // Extract the user ID from the response
      let userId = userResponse.id;
      
      if (!userId) {
        throw new Error('Could not get current user ID');
      }
      
      // Use the user ID as is - backend now handles IDs with or without dashes
      const response = await this.props.services.api.get(
        `/api/v1/users/${userId}/conversations`,
        {
          params: {
            skip: 0,
            limit: 50 // Fetch up to 50 conversations
          }
        }
      );
      
      let conversations: ConversationInfo[] = [];
      
      if (Array.isArray(response)) {
        conversations = response;
      } else if (response && response.data && Array.isArray(response.data)) {
        conversations = response.data;
      } else if (response) {
        // Try to extract conversations from the response in a different way
        try {
          if (typeof response === 'object') {
            // Check if the response itself might be the conversations array
            if (response.id && response.user_id) {
              conversations = [response as ConversationInfo];
            }
          }
        } catch (parseError) {
          // Error parsing response
        }
      }
      
      if (conversations.length === 0) {
        // No conversations yet, but this is not an error
        this.setState({
          conversations: [],
          dropdownOptions: [],
          isLoading: false
        });
        
        return;
      }
      
      // Validate conversation objects
      const validConversations = conversations.filter(conv => {
        const isValid = conv && typeof conv === 'object' && conv.id && conv.user_id;
        if (!isValid) {
          // Invalid conversation object
        }
        return isValid;
      });
      
      // Sort conversations by most recently updated or created
      validConversations.sort((a, b) => {
        // Use updated_at if available for both conversations
        if (a.updated_at && b.updated_at) {
          return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
        }
        
        // If only one has updated_at, prioritize that one
        if (a.updated_at && !b.updated_at) {
          return -1; // a comes first
        }
        
        if (!a.updated_at && b.updated_at) {
          return 1; // b comes first
        }
        
        // If neither has updated_at, fall back to created_at
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
      
      // Debug log: Show the most recent conversation in the list
      if (validConversations.length > 0) {
        console.log('Most recent conversation in list:', {
          id: validConversations[0].id,
          title: validConversations[0].title || 'Untitled Conversation',
          updated_at: validConversations[0].updated_at,
          model: validConversations[0].model
        });
      } else {
        console.log('No conversations found in the list');
      }
      
      // Create dropdown options - this reverses the order for display
      const dropdownOptions = this.createDropdownOptions(validConversations);
      
      // Auto-select the most recent conversation if available
      // Since we're reversing the order for display, we need to select the conversation
      // that will appear at the top of the dropdown (which is the most recent one)
      const mostRecentConversation = validConversations.length > 0 ? validConversations[0] : null;
      
      // Debug log: Show which conversation will be auto-selected
      if (mostRecentConversation) {
        console.log('Auto-selecting conversation:', {
          id: mostRecentConversation.id,
          title: mostRecentConversation.title || 'Untitled Conversation',
          updated_at: mostRecentConversation.updated_at,
          model: mostRecentConversation.model
        });
      } else {
        console.log('No conversation to auto-select');
      }
      
      this.setState({
        conversations: validConversations,
        dropdownOptions,
        selectedConversation: mostRecentConversation,
        isLoading: false
      }, () => {
        // Broadcast the selection if we have a conversation
        if (mostRecentConversation) {
          this.broadcastConversationSelection(mostRecentConversation);
          
          // Force update dropdown selection to show the most recent conversation
          const dropdownElement = document.querySelector('.custom-dropdown-select') as HTMLSelectElement;
          if (dropdownElement) {
            dropdownElement.value = mostRecentConversation.id;
          }
        }
      });
      return validConversations; // Return the conversations for promise chaining
    } catch (error: any) {
      // Check if it's a 403 Forbidden error
      if (error.status === 403 || (error.response && error.response.status === 403)) {
        // Show empty state for better user experience
        this.setState({
          isLoading: false,
          conversations: [],
          dropdownOptions: [],
          error: null // Don't show an error message to the user
        });
      } else if (error.status === 404 || (error.response && error.response.status === 404)) {
        // Handle 404 errors (no conversations found)
        this.setState({
          isLoading: false,
          conversations: [],
          dropdownOptions: [],
          error: null // Don't show an error message to the user
        });
      } else {
        // Handle other errors
        this.setState({
          isLoading: false,
          error: `Error loading conversations: ${error.message || 'Unknown error'}`
        });
      }
    }
  }
  
  /**
   * Create dropdown options from conversations
   */
  createDropdownOptions(conversations: ConversationInfo[]): ConversationDropdownOption[] {
    // Map conversations to dropdown options
    const options = conversations.map(conv => {
      return {
        id: conv.id,
        primaryText: conv.title || 'Untitled Conversation',
        secondaryText: conv.model || 'Unknown Model',
        metadata: {
          model: conv.model || 'Unknown Model',
          server: conv.server,
          created_at: conv.created_at,
          updated_at: conv.updated_at
        }
      };
    });
    
    // Reverse the order so most recent appears at the top of the dropdown
    return options.reverse();
  }
  
  /**
   * Handle conversation selection
   */
  handleConversationSelect = (conversationId: string) => {
    const selectedConversation = this.state.conversations.find(
      conv => conv.id === conversationId
    );
    
    if (selectedConversation) {
      this.setState({ selectedConversation }, () => {
        this.broadcastConversationSelection(selectedConversation);
      });
    }
  };
  
  /**
   * Handle new chat button click
   */
  handleNewChatClick = () => {
    this.setState({ selectedConversation: null }, () => {
      this.broadcastNewChat();
    });
  };
  
  /**
   * Handle rename button click
   */
  handleRenameClick = () => {
    this.setState({ isRenameDialogOpen: true });
  };
  
  /**
   * Handle delete button click
   */
  handleDeleteClick = () => {
    this.setState({ isDeleteDialogOpen: true });
  };
  
  /**
   * Handle rename dialog save
   */
  handleRenameDialogSave = async (newTitle: string) => {
    if (!this.state.selectedConversation || !this.props.services?.api) {
      this.setState({ isRenameDialogOpen: false });
      return;
    }
    
    try {
      this.setState({ isUpdating: true });
      
      const conversationId = this.state.selectedConversation.id;
      
      await this.props.services.api.put(
        `/api/v1/conversations/${conversationId}`,
        { title: newTitle }
      );
      
      // Update state
      this.setState(prevState => {
        // Update in conversations array
        const updatedConversations = prevState.conversations.map(conv => 
          conv.id === conversationId 
            ? { ...conv, title: newTitle } 
            : conv
        );
        
        // Update dropdown options
        const updatedOptions = this.createDropdownOptions(updatedConversations);
        
        // Update selected conversation
        const updatedSelectedConversation = { 
          ...prevState.selectedConversation!, 
          title: newTitle 
        };
        
        return {
          conversations: updatedConversations,
          dropdownOptions: updatedOptions,
          selectedConversation: updatedSelectedConversation,
          isUpdating: false,
          isRenameDialogOpen: false
        };
      });
      
    } catch (error: any) {
      this.setState({ 
        isUpdating: false,
        error: `Error renaming conversation: ${error.message || 'Unknown error'}`,
        isRenameDialogOpen: false
      });
    }
  };
  
  /**
   * Handle delete dialog confirm
   */
  handleDeleteDialogConfirm = async () => {
    if (!this.state.selectedConversation || !this.props.services?.api) {
      this.setState({ isDeleteDialogOpen: false });
      return;
    }
    
    try {
      this.setState({ isUpdating: true });
      
      const conversationId = this.state.selectedConversation.id;
      
      await this.props.services.api.delete(`/api/v1/conversations/${conversationId}`);
      
      // Update state
      this.setState(prevState => {
        // Remove from conversations array
        const updatedConversations = prevState.conversations.filter(
          conv => conv.id !== conversationId
        );
        
        // Update dropdown options
        const updatedOptions = this.createDropdownOptions(updatedConversations);
        
        return {
          conversations: updatedConversations,
          dropdownOptions: updatedOptions,
          selectedConversation: null,
          isUpdating: false,
          isDeleteDialogOpen: false
        };
      });
      
      // Broadcast new chat event
      this.broadcastNewChat();
      
    } catch (error: any) {
      this.setState({ 
        isUpdating: false,
        error: `Error deleting conversation: ${error.message || 'Unknown error'}`,
        isDeleteDialogOpen: false
      });
    }
  };
  
  /**
   * Handle dialog cancel
   */
  handleDialogCancel = () => {
    this.setState({ 
      isRenameDialogOpen: false,
      isDeleteDialogOpen: false
    });
  };
  
  /**
   * Broadcast conversation selection event
   */
  broadcastConversationSelection(conversation: ConversationInfo) {
    if (!this.eventService && !this.props.services?.event) {
      return;
    }
    
    // Create conversation selection message
    const conversationInfo = {
      type: 'conversation.selection',
      content: {
        conversation_id: conversation.id,
        timestamp: new Date().toISOString()
      }
    };
    
    // Send to AIPromptChat
    
    if (this.props.services?.event) {
      this.props.services.event.sendMessage('ai-prompt-chat', conversationInfo.content);
    }
    
    if (this.eventService) {
      this.eventService.sendMessage('ai-prompt-chat', conversationInfo, { remote: true });
    }
    
    // If conversation has model info, send to model selection component
    if (conversation.model) {
      this.broadcastModelSelection(conversation);
    }
  }
  
  /**
   * Broadcast model selection event
   */
  broadcastModelSelection(conversation: ConversationInfo) {
    if (!conversation.model || !conversation.server) {
      return;
    }
    
    if (!this.eventService && !this.props.services?.event) {
      return;
    }
    
    // For model selection, we need to use the exact model name without parsing
    // The ComponentModelSelection expects a specific format for model IDs
    
    // Create model info with the exact model name
    const modelInfo: ModelInfo = {
      name: conversation.model,
      provider: 'unknown',
      providerId: 'unknown_settings',
      serverId: conversation.server,
      serverName: conversation.server
    };
    
    // Create model selection message
    const modelSelectionInfo = {
      type: 'model.selection',
      content: {
        model: modelInfo,
        timestamp: new Date().toISOString()
      }
    };
    
    // Send to model selection component
    
    if (this.props.services?.event) {
      this.props.services.event.sendMessage('model-selection-v2', modelSelectionInfo.content);
    }
    
    if (this.eventService) {
      this.eventService.sendMessage('model-selection-v2', modelSelectionInfo, { remote: true });
    }
  }
  
  /**
   * Broadcast new chat event
   */
  broadcastNewChat() {
    if (!this.eventService && !this.props.services?.event) {
      // Event service not available
      return;
    }
    
    // Create new chat message
    const newChatInfo = {
      type: 'conversation.new',
      content: {
        timestamp: new Date().toISOString()
      }
    };
    
    // Send to AIPromptChat
    
    if (this.props.services?.event) {
      this.props.services.event.sendMessage('ai-prompt-chat', newChatInfo.content);
    }
    
    if (this.eventService) {
      this.eventService.sendMessage('ai-prompt-chat', newChatInfo, { remote: true });
    }
  }
  
  /**
   * Render the component
   */
  render() {
    const { 
      dropdownOptions, 
      selectedConversation,
      isLoading, 
      isUpdating,
      error, 
      currentTheme,
      isRenameDialogOpen,
      isDeleteDialogOpen
    } = this.state;
    
    const themeClass = currentTheme === 'dark' ? 'dark-theme' : '';
    
    // Loading state
    if (isLoading) {
      return (
        <div className={`ai-chat-history-container ${themeClass}`}>
          <div className="history-layout">
            <button
              className="history-icon-button primary"
              disabled={true}
              title="New Chat"
              aria-label="New Chat"
            >
              <PlusIcon />
            </button>
            <div className="history-dropdown-section">
              <div className="history-loading">Loading conversations...</div>
            </div>
          </div>
        </div>
      );
    }
    
    // Error state
    if (error) {
      return (
        <div className={`ai-chat-history-container ${themeClass}`}>
          <div className="history-layout">
            <button
              className="history-icon-button primary"
              onClick={() => this.fetchConversations()}
              title="Retry"
              aria-label="Retry"
            >
              <PlusIcon />
            </button>
            <div className="history-dropdown-section">
              <div className="history-error">{error}</div>
            </div>
          </div>
        </div>
      );
    }
    
    // Empty state
    if (dropdownOptions.length === 0) {
      return (
        <div className={`ai-chat-history-container ${themeClass}`}>
          <div className="history-layout">
            <button
              className="history-icon-button primary"
              onClick={this.handleNewChatClick}
              title="New Chat"
              aria-label="New Chat"
            >
              <PlusIcon />
            </button>
            <div className="history-dropdown-section">
              <div className="history-empty">No conversations yet.</div>
            </div>
          </div>
        </div>
      );
    }
    
    // Enhance dropdown options with relative time
    const enhancedOptions = dropdownOptions.map(option => {
      const updatedAt = option.metadata?.updated_at;
      const relativeTime = updatedAt ? formatRelativeTime(updatedAt) : '';
      
      return {
        ...option,
        // We'll use the CustomDropdown component which expects primaryText and secondaryText
        // But we'll customize the rendering in the dropdown to show the relative time
        secondaryText: option.secondaryText,
        metadata: {
          ...option.metadata,
          relativeTime
        }
      };
    });
    
    return (
      <div className={`ai-chat-history-container ${themeClass}`}>
        <div className="history-layout">
          {/* New Chat button (plus icon) on the left */}
          <button
            className="history-icon-button primary"
            onClick={this.handleNewChatClick}
            disabled={isUpdating}
            title="New Chat"
            aria-label="New Chat"
          >
            <PlusIcon />
          </button>
          
          {/* Dropdown in the middle (takes most space) */}
          <div className="history-dropdown-section">
            <CustomDropdown
              options={enhancedOptions}
              selectedId={selectedConversation?.id || ''}
              onChange={this.handleConversationSelect}
              placeholder="Select a conversation"
              disabled={isUpdating}
              ariaLabel="Conversation history"
            />
          </div>
          
          {/* Edit and Delete buttons on the right */}
          <div className="history-actions-section">
            <button
              className="history-icon-button secondary"
              onClick={this.handleRenameClick}
              disabled={!selectedConversation || isUpdating}
              title="Rename Conversation"
              aria-label="Rename Conversation"
            >
              <PencilIcon />
            </button>
            
            <button
              className="history-icon-button danger"
              onClick={this.handleDeleteClick}
              disabled={!selectedConversation || isUpdating}
              title="Delete Conversation"
              aria-label="Delete Conversation"
            >
              <TrashIcon />
            </button>
          </div>
        </div>
        
        {/* Rename Dialog */}
        <RenameDialog
          isOpen={isRenameDialogOpen}
          currentTitle={selectedConversation?.title || ''}
          onSave={this.handleRenameDialogSave}
          onCancel={this.handleDialogCancel}
          theme={currentTheme}
        />
        
        {/* Delete Confirmation Dialog */}
        <DeleteConfirmationDialog
          isOpen={isDeleteDialogOpen}
          conversationTitle={selectedConversation?.title || ''}
          onConfirm={this.handleDeleteDialogConfirm}
          onCancel={this.handleDialogCancel}
          theme={currentTheme}
        />
      </div>
    );
  }
}

// Add a version for tracking purposes
(AIChatHistory as any).version = '1.0.0';

export default AIChatHistory;