// Types for the AI Prompt Chat component

export interface ApiResponse {
  data?: any;
  status?: number;
  id?: string;
  [key: string]: any;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'ai';
  content: string;
  timestamp: string;
  isStreaming?: boolean;
}

export interface Services {
  api?: {
    get: (url: string, options?: any) => Promise<ApiResponse>;
    post: (url: string, data: any, options?: any) => Promise<ApiResponse>;
    postStreaming?: (url: string, data: any, onChunk: (chunk: string) => void, options?: any) => Promise<ApiResponse>;
  };
  theme?: {
    getCurrentTheme: () => string;
    addThemeChangeListener: (callback: (theme: string) => void) => void;
    removeThemeChangeListener: (callback: (theme: string) => void) => void;
  };
  event?: {
    sendMessage: (type: string, content: any) => void;
    subscribeToMessages: (type: string, callback: (content: any) => void) => void;
    unsubscribeFromMessages: (type: string, callback: (content: any) => void) => void;
  };
  settings?: {
    get: (key: string) => any;
    set: (key: string, value: any) => Promise<void>;
  };
}

export interface AIPromptChatProps {
  services: Services;
  initialGreeting?: string;
  promptQuestion?: string;
  chatHistoryId?: string; // For future functionality
  defaultStreamingMode?: boolean; // Default streaming mode setting
}

export interface ModelInfo {
  name: string;
  provider?: string;
  providerId?: string;
  serverId?: string;
  [key: string]: any;
}
