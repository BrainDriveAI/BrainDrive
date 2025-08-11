import { 
  CollaborationState, 
  Collaborator, 
  CollaboratorCursor, 
  CollaboratorSelection,
  Comment,
  CommentReply,
  Version,
  VersionHistory
} from '../types/studio';
import { LayoutItem } from '../types/core';

export interface CollaborationConfig {
  serverUrl?: string;
  autoSave: boolean;
  conflictResolution: 'manual' | 'auto-merge' | 'last-write-wins';
  heartbeatInterval: number;
  reconnectAttempts: number;
  reconnectDelay: number;
}

export interface CollaborationEvent {
  type: string;
  userId: string;
  timestamp: number;
  data: any;
}

export interface LayoutChangeEvent extends CollaborationEvent {
  type: 'layout-change';
  data: {
    layouts: Record<string, LayoutItem[]>;
    breakpoint: string;
    changeId: string;
  };
}

export interface CursorMoveEvent extends CollaborationEvent {
  type: 'cursor-move';
  data: {
    position: { x: number; y: number };
    visible: boolean;
  };
}

export interface SelectionChangeEvent extends CollaborationEvent {
  type: 'selection-change';
  data: {
    itemIds: string[];
  };
}

export interface CommentEvent extends CollaborationEvent {
  type: 'comment-add' | 'comment-update' | 'comment-delete';
  data: {
    comment: Comment;
  };
}

export interface UserJoinEvent extends CollaborationEvent {
  type: 'user-join' | 'user-leave';
  data: {
    user: Collaborator;
  };
}

const defaultConfig: CollaborationConfig = {
  autoSave: true,
  conflictResolution: 'auto-merge',
  heartbeatInterval: 30000, // 30 seconds
  reconnectAttempts: 5,
  reconnectDelay: 1000 // 1 second
};

export class CollaborationService {
  private config: CollaborationConfig;
  private websocket: WebSocket | null = null;
  private state: CollaborationState;
  private eventHandlers: Map<string, Set<(event: CollaborationEvent) => void>> = new Map();
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private isConnecting = false;

  constructor(config: Partial<CollaborationConfig> = {}) {
    this.config = { ...defaultConfig, ...config };
    this.state = {
      enabled: false,
      sessionId: '',
      userId: '',
      collaborators: [],
      cursors: [],
      selections: []
    };
  }

  // Initialize collaboration session
  async initialize(sessionId: string, userId: string): Promise<void> {
    this.state = {
      ...this.state,
      enabled: true,
      sessionId,
      userId
    };

    if (this.config.serverUrl) {
      await this.connect();
    }
  }

  // Connect to collaboration server
  private async connect(): Promise<void> {
    if (this.isConnecting || this.websocket?.readyState === WebSocket.OPEN) {
      return;
    }

    this.isConnecting = true;

    try {
      const wsUrl = `${this.config.serverUrl}/collaboration/${this.state.sessionId}?userId=${this.state.userId}`;
      this.websocket = new WebSocket(wsUrl);

      this.websocket.onopen = () => {
        console.log('[CollaborationService] Connected to collaboration server');
        this.isConnecting = false;
        this.reconnectAttempts = 0;
        this.startHeartbeat();
        this.emit('connection', { type: 'connected' });
      };

      this.websocket.onmessage = (event) => {
        try {
          const collaborationEvent: CollaborationEvent = JSON.parse(event.data);
          this.handleServerEvent(collaborationEvent);
        } catch (error) {
          console.error('[CollaborationService] Failed to parse server message:', error);
        }
      };

      this.websocket.onclose = () => {
        console.log('[CollaborationService] Disconnected from collaboration server');
        this.isConnecting = false;
        this.stopHeartbeat();
        this.emit('connection', { type: 'disconnected' });
        this.scheduleReconnect();
      };

      this.websocket.onerror = (error) => {
        console.error('[CollaborationService] WebSocket error:', error);
        this.isConnecting = false;
        this.emit('connection', { type: 'error', error });
      };
    } catch (error) {
      console.error('[CollaborationService] Failed to connect:', error);
      this.isConnecting = false;
      this.scheduleReconnect();
    }
  }

  // Disconnect from collaboration server
  disconnect(): void {
    this.state.enabled = false;
    this.stopHeartbeat();
    this.clearReconnectTimer();
    
    if (this.websocket) {
      this.websocket.close();
      this.websocket = null;
    }
  }

  // Send event to collaboration server
  private sendEvent(event: Omit<CollaborationEvent, 'userId' | 'timestamp'>): void {
    if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
      console.warn('[CollaborationService] Cannot send event: not connected');
      return;
    }

    const fullEvent: CollaborationEvent = {
      ...event,
      userId: this.state.userId,
      timestamp: Date.now()
    };

    this.websocket.send(JSON.stringify(fullEvent));
  }

  // Handle events from server
  private handleServerEvent(event: CollaborationEvent): void {
    // Don't process our own events
    if (event.userId === this.state.userId) {
      return;
    }

    switch (event.type) {
      case 'user-join':
        this.handleUserJoin(event as UserJoinEvent);
        break;
      case 'user-leave':
        this.handleUserLeave(event as UserJoinEvent);
        break;
      case 'cursor-move':
        this.handleCursorMove(event as CursorMoveEvent);
        break;
      case 'selection-change':
        this.handleSelectionChange(event as SelectionChangeEvent);
        break;
      case 'layout-change':
        this.handleLayoutChange(event as LayoutChangeEvent);
        break;
      case 'comment-add':
      case 'comment-update':
      case 'comment-delete':
        this.handleCommentEvent(event as CommentEvent);
        break;
    }

    // Emit to local handlers
    this.emit(event.type, event);
  }

  // User management
  private handleUserJoin(event: UserJoinEvent): void {
    const existingIndex = this.state.collaborators.findIndex(c => c.id === event.data.user.id);
    if (existingIndex === -1) {
      this.state.collaborators.push({
        ...event.data.user,
        isActive: true,
        lastSeen: new Date(event.timestamp)
      });
    } else {
      this.state.collaborators[existingIndex] = {
        ...this.state.collaborators[existingIndex],
        isActive: true,
        lastSeen: new Date(event.timestamp)
      };
    }
  }

  private handleUserLeave(event: UserJoinEvent): void {
    const userIndex = this.state.collaborators.findIndex(c => c.id === event.data.user.id);
    if (userIndex !== -1) {
      this.state.collaborators[userIndex].isActive = false;
      this.state.collaborators[userIndex].lastSeen = new Date(event.timestamp);
    }

    // Remove user's cursor and selection
    this.state.cursors = this.state.cursors.filter(c => c.userId !== event.data.user.id);
    this.state.selections = this.state.selections.filter(s => s.userId !== event.data.user.id);
  }

  // Cursor management
  private handleCursorMove(event: CursorMoveEvent): void {
    const existingIndex = this.state.cursors.findIndex(c => c.userId === event.userId);
    const cursor: CollaboratorCursor = {
      userId: event.userId,
      position: event.data.position,
      visible: event.data.visible
    };

    if (existingIndex === -1) {
      this.state.cursors.push(cursor);
    } else {
      this.state.cursors[existingIndex] = cursor;
    }
  }

  // Selection management
  private handleSelectionChange(event: SelectionChangeEvent): void {
    const user = this.state.collaborators.find(c => c.id === event.userId);
    if (!user) return;

    const existingIndex = this.state.selections.findIndex(s => s.userId === event.userId);
    const selection: CollaboratorSelection = {
      userId: event.userId,
      itemIds: event.data.itemIds,
      color: user.color
    };

    if (existingIndex === -1) {
      this.state.selections.push(selection);
    } else {
      this.state.selections[existingIndex] = selection;
    }
  }

  // Layout change management
  private handleLayoutChange(event: LayoutChangeEvent): void {
    // Handle conflict resolution based on configuration
    switch (this.config.conflictResolution) {
      case 'last-write-wins':
        // Simply accept the change
        this.emit('layout-change-received', event);
        break;
      case 'auto-merge':
        // Attempt to merge changes
        this.emit('layout-change-merge', event);
        break;
      case 'manual':
        // Present conflict to user
        this.emit('layout-change-conflict', event);
        break;
    }
  }

  // Comment management
  private handleCommentEvent(event: CommentEvent): void {
    this.emit('comment-event', event);
  }

  // Public API methods
  broadcastCursorMove(position: { x: number; y: number }, visible: boolean): void {
    if (!this.state.enabled) return;

    this.sendEvent({
      type: 'cursor-move',
      data: { position, visible }
    });
  }

  broadcastSelectionChange(itemIds: string[]): void {
    if (!this.state.enabled) return;

    this.sendEvent({
      type: 'selection-change',
      data: { itemIds }
    });
  }

  broadcastLayoutChange(layouts: Record<string, LayoutItem[]>, breakpoint: string, changeId: string): void {
    if (!this.state.enabled) return;

    this.sendEvent({
      type: 'layout-change',
      data: { layouts, breakpoint, changeId }
    });
  }

  addComment(comment: Omit<Comment, 'id' | 'timestamp'>): void {
    if (!this.state.enabled) return;

    const fullComment: Comment = {
      ...comment,
      id: `comment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      replies: []
    };

    this.sendEvent({
      type: 'comment-add',
      data: { comment: fullComment }
    });
  }

  // Event handling
  on(eventType: string, handler: (event: CollaborationEvent) => void): () => void {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, new Set());
    }
    
    this.eventHandlers.get(eventType)!.add(handler);
    
    // Return unsubscribe function
    return () => {
      const handlers = this.eventHandlers.get(eventType);
      if (handlers) {
        handlers.delete(handler);
      }
    };
  }

  private emit(eventType: string, event: any): void {
    const handlers = this.eventHandlers.get(eventType);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(event);
        } catch (error) {
          console.error(`[CollaborationService] Event handler error for ${eventType}:`, error);
        }
      });
    }
  }

  // Heartbeat management
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.websocket?.readyState === WebSocket.OPEN) {
        this.sendEvent({
          type: 'heartbeat',
          data: {}
        });
      }
    }, this.config.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // Reconnection management
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.config.reconnectAttempts) {
      console.error('[CollaborationService] Max reconnection attempts reached');
      return;
    }

    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++;
      console.log(`[CollaborationService] Reconnection attempt ${this.reconnectAttempts}/${this.config.reconnectAttempts}`);
      this.connect();
    }, this.config.reconnectDelay * Math.pow(2, this.reconnectAttempts)); // Exponential backoff
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // Getters
  getState(): CollaborationState {
    return { ...this.state };
  }

  isEnabled(): boolean {
    return this.state.enabled;
  }

  isConnected(): boolean {
    return this.websocket?.readyState === WebSocket.OPEN;
  }

  // Cleanup
  destroy(): void {
    this.disconnect();
    this.eventHandlers.clear();
  }
}

export default CollaborationService;