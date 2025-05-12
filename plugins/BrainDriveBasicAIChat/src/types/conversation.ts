// Types for the AI Chat History component

/**
 * Interface for conversation data from the API
 */
export interface ConversationInfo {
  id: string;
  user_id: string;
  title: string;
  page_context: string | null;
  model: string | null; 
  server: string | null;
  created_at: string;
  updated_at: string;
  tags: Array<{ id: string; name: string }>;
}

/**
 * Interface for message data from the API
 */
export interface ConversationMessage {
  id: string;
  conversation_id: string;
  sender: string; // 'user' or 'llm'
  message: string;
  message_metadata: any | null;
  created_at: string;
  updated_at: string | null;
}

/**
 * Interface for conversation with messages
 */
export interface ConversationWithMessages extends ConversationInfo {
  messages: ConversationMessage[];
}

/**
 * Interface for dropdown option for conversations
 */
export interface ConversationDropdownOption {
  id: string;
  primaryText: string;
  secondaryText: string;
  metadata?: {
    model?: string;
    server?: string | null;
    created_at: string;
    updated_at: string;
    relativeTime?: string;
  };
}

/**
 * Interface for model info to be sent via events
 */
export interface ModelSelection {
  name: string;
  provider: string;
  providerId: string;
  serverName: string;
  serverId: string;
}