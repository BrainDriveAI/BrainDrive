import { useState, useEffect, useCallback, useRef } from 'react';
import { CollaborationService, CollaborationConfig } from '../services/CollaborationService';
import { 
  CollaborationState, 
  Collaborator, 
  CollaboratorCursor, 
  CollaboratorSelection,
  Comment
} from '../types/studio';
import { LayoutItem } from '../types/core';

export interface UseCollaborationOptions {
  sessionId: string;
  userId: string;
  userName: string;
  userAvatar?: string;
  config?: Partial<CollaborationConfig>;
  
  // Event handlers
  onLayoutChange?: (layouts: Record<string, LayoutItem[]>, changeId: string) => void;
  onLayoutConflict?: (conflictData: any) => void;
  onCommentAdd?: (comment: Comment) => void;
  onUserJoin?: (user: Collaborator) => void;
  onUserLeave?: (user: Collaborator) => void;
}

export interface UseCollaborationReturn {
  // State
  collaborationState: CollaborationState;
  isConnected: boolean;
  isEnabled: boolean;
  
  // Actions
  initialize: () => Promise<void>;
  disconnect: () => void;
  
  // Cursor management
  updateCursor: (position: { x: number; y: number }, visible?: boolean) => void;
  hideCursor: () => void;
  
  // Selection management
  updateSelection: (itemIds: string[]) => void;
  clearSelection: () => void;
  
  // Layout management
  broadcastLayoutChange: (layouts: Record<string, LayoutItem[]>, breakpoint: string) => void;
  
  // Comments
  addComment: (content: string, position: { x: number; y: number }, itemId?: string) => void;
  
  // Collaboration data
  collaborators: Collaborator[];
  cursors: CollaboratorCursor[];
  selections: CollaboratorSelection[];
}

/**
 * Hook for real-time collaboration features
 */
export const useCollaboration = (options: UseCollaborationOptions): UseCollaborationReturn => {
  const {
    sessionId,
    userId,
    userName,
    userAvatar,
    config = {},
    onLayoutChange,
    onLayoutConflict,
    onCommentAdd,
    onUserJoin,
    onUserLeave
  } = options;

  // State
  const [collaborationState, setCollaborationState] = useState<CollaborationState>({
    enabled: false,
    sessionId: '',
    userId: '',
    collaborators: [],
    cursors: [],
    selections: []
  });

  const [isConnected, setIsConnected] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  // Service instance
  const serviceRef = useRef<CollaborationService | null>(null);
  const unsubscribersRef = useRef<(() => void)[]>([]);

  // Initialize collaboration service
  const initialize = useCallback(async () => {
    if (isInitialized || serviceRef.current) {
      return;
    }

    try {
      // Create service instance
      serviceRef.current = new CollaborationService(config);
      
      // Set up event listeners
      const unsubscribers: (() => void)[] = [];

      // Connection events
      unsubscribers.push(
        serviceRef.current.on('connection', (event) => {
          setIsConnected(event.type === 'connected');
        })
      );

      // User events
      unsubscribers.push(
        serviceRef.current.on('user-join', (event) => {
          const user = event.data.user;
          setCollaborationState(prev => ({
            ...prev,
            collaborators: [...prev.collaborators.filter(c => c.id !== user.id), user]
          }));
          onUserJoin?.(user);
        })
      );

      unsubscribers.push(
        serviceRef.current.on('user-leave', (event) => {
          const user = event.data.user;
          setCollaborationState(prev => ({
            ...prev,
            collaborators: prev.collaborators.map(c => 
              c.id === user.id ? { ...c, isActive: false } : c
            ),
            cursors: prev.cursors.filter(cursor => cursor.userId !== user.id),
            selections: prev.selections.filter(selection => selection.userId !== user.id)
          }));
          onUserLeave?.(user);
        })
      );

      // Cursor events
      unsubscribers.push(
        serviceRef.current.on('cursor-move', (event) => {
          setCollaborationState(prev => {
            const existingIndex = prev.cursors.findIndex(c => c.userId === event.userId);
            const newCursor: CollaboratorCursor = {
              userId: event.userId,
              position: event.data.position,
              visible: event.data.visible
            };

            const newCursors = [...prev.cursors];
            if (existingIndex === -1) {
              newCursors.push(newCursor);
            } else {
              newCursors[existingIndex] = newCursor;
            }

            return { ...prev, cursors: newCursors };
          });
        })
      );

      // Selection events
      unsubscribers.push(
        serviceRef.current.on('selection-change', (event) => {
          const user = collaborationState.collaborators.find(c => c.id === event.userId);
          if (!user) return;

          setCollaborationState(prev => {
            const existingIndex = prev.selections.findIndex(s => s.userId === event.userId);
            const newSelection: CollaboratorSelection = {
              userId: event.userId,
              itemIds: event.data.itemIds,
              color: user.color
            };

            const newSelections = [...prev.selections];
            if (existingIndex === -1) {
              newSelections.push(newSelection);
            } else {
              newSelections[existingIndex] = newSelection;
            }

            return { ...prev, selections: newSelections };
          });
        })
      );

      // Layout events
      unsubscribers.push(
        serviceRef.current.on('layout-change-received', (event) => {
          onLayoutChange?.(event.data.layouts, event.data.changeId);
        })
      );

      unsubscribers.push(
        serviceRef.current.on('layout-change-conflict', (event) => {
          onLayoutConflict?.(event.data);
        })
      );

      // Comment events
      unsubscribers.push(
        serviceRef.current.on('comment-event', (event) => {
          if (event.type === 'comment-add') {
            onCommentAdd?.(event.data.comment);
          }
        })
      );

      unsubscribersRef.current = unsubscribers;

      // Initialize the service
      await serviceRef.current.initialize(sessionId, userId);
      
      // Update state
      setCollaborationState(serviceRef.current.getState());
      setIsInitialized(true);
      setIsConnected(serviceRef.current.isConnected());

    } catch (error) {
      console.error('[useCollaboration] Failed to initialize:', error);
    }
  }, [
    isInitialized, 
    config, 
    sessionId, 
    userId, 
    onLayoutChange, 
    onLayoutConflict, 
    onCommentAdd, 
    onUserJoin, 
    onUserLeave,
    collaborationState.collaborators
  ]);

  // Disconnect from collaboration
  const disconnect = useCallback(() => {
    if (serviceRef.current) {
      serviceRef.current.disconnect();
      serviceRef.current = null;
    }

    // Clean up event listeners
    unsubscribersRef.current.forEach(unsubscribe => unsubscribe());
    unsubscribersRef.current = [];

    setIsInitialized(false);
    setIsConnected(false);
    setCollaborationState({
      enabled: false,
      sessionId: '',
      userId: '',
      collaborators: [],
      cursors: [],
      selections: []
    });
  }, []);

  // Update cursor position
  const updateCursor = useCallback((position: { x: number; y: number }, visible = true) => {
    if (serviceRef.current && isConnected) {
      serviceRef.current.broadcastCursorMove(position, visible);
    }
  }, [isConnected]);

  // Hide cursor
  const hideCursor = useCallback(() => {
    updateCursor({ x: 0, y: 0 }, false);
  }, [updateCursor]);

  // Update selection
  const updateSelection = useCallback((itemIds: string[]) => {
    if (serviceRef.current && isConnected) {
      serviceRef.current.broadcastSelectionChange(itemIds);
    }
  }, [isConnected]);

  // Clear selection
  const clearSelection = useCallback(() => {
    updateSelection([]);
  }, [updateSelection]);

  // Broadcast layout change
  const broadcastLayoutChange = useCallback((layouts: Record<string, LayoutItem[]>, breakpoint: string) => {
    if (serviceRef.current && isConnected) {
      const changeId = `change_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      serviceRef.current.broadcastLayoutChange(layouts, breakpoint, changeId);
    }
  }, [isConnected]);

  // Add comment
  const addComment = useCallback((content: string, position: { x: number; y: number }, itemId?: string) => {
    if (serviceRef.current && isConnected) {
      serviceRef.current.addComment({
        userId,
        content,
        position,
        itemId,
        resolved: false,
        replies: []
      });
    }
  }, [isConnected, userId]);

  // Auto-initialize when options change
  useEffect(() => {
    if (sessionId && userId && !isInitialized) {
      initialize();
    }
  }, [sessionId, userId, isInitialized, initialize]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  // Update collaboration state when service state changes
  useEffect(() => {
    if (serviceRef.current) {
      const interval = setInterval(() => {
        const newState = serviceRef.current?.getState();
        if (newState) {
          setCollaborationState(newState);
        }
      }, 1000); // Update every second

      return () => clearInterval(interval);
    }
  }, [isInitialized]);

  return {
    // State
    collaborationState,
    isConnected,
    isEnabled: collaborationState.enabled,
    
    // Actions
    initialize,
    disconnect,
    
    // Cursor management
    updateCursor,
    hideCursor,
    
    // Selection management
    updateSelection,
    clearSelection,
    
    // Layout management
    broadcastLayoutChange,
    
    // Comments
    addComment,
    
    // Collaboration data
    collaborators: collaborationState.collaborators,
    cursors: collaborationState.cursors,
    selections: collaborationState.selections
  };
};

export default useCollaboration;