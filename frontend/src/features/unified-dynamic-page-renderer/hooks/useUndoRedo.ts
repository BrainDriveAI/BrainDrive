import { useState, useCallback, useRef, useEffect } from 'react';
import { 
  Command, 
  CommandHistory, 
  UndoRedoState, 
  UseUndoRedoReturn,
  LayoutCommand,
  ModuleCommand
} from '../types/studio';
import { LayoutItem, ModuleConfig } from '../types/core';

export interface UseUndoRedoOptions {
  maxHistorySize?: number;
  enableKeyboardShortcuts?: boolean;
  onStateChange?: (state: UndoRedoState) => void;
}

/**
 * Hook for implementing undo/redo functionality using the command pattern
 */
export const useUndoRedo = (options: UseUndoRedoOptions = {}): UseUndoRedoReturn => {
  const {
    maxHistorySize = 50,
    enableKeyboardShortcuts = true,
    onStateChange
  } = options;

  // State
  const [history, setHistory] = useState<CommandHistory>({
    commands: [],
    currentIndex: -1,
    maxSize: maxHistorySize,
    canUndo: false,
    canRedo: false
  });

  const [isExecuting, setIsExecuting] = useState(false);
  const [lastCommand, setLastCommand] = useState<Command | null>(null);
  
  // Refs to prevent stale closures
  const historyRef = useRef(history);
  const isExecutingRef = useRef(isExecuting);

  // Update refs when state changes
  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  useEffect(() => {
    isExecutingRef.current = isExecuting;
  }, [isExecuting]);

  // Update undo/redo availability
  const updateAvailability = useCallback((newHistory: CommandHistory) => {
    const canUndo = newHistory.currentIndex >= 0;
    const canRedo = newHistory.currentIndex < newHistory.commands.length - 1;
    
    return {
      ...newHistory,
      canUndo,
      canRedo
    };
  }, []);

  // Execute a command and add it to history
  const executeCommand = useCallback((command: Command) => {
    if (isExecutingRef.current) {
      console.warn('[useUndoRedo] Cannot execute command while another is executing');
      return;
    }

    setIsExecuting(true);
    
    try {
      // Execute the command
      command.execute();
      
      setHistory(prevHistory => {
        let newCommands = [...prevHistory.commands];
        let newIndex = prevHistory.currentIndex;
        
        // Remove any commands after current index (when we're in the middle of history)
        if (newIndex < newCommands.length - 1) {
          newCommands = newCommands.slice(0, newIndex + 1);
        }
        
        // Check if we can merge with the previous command
        const lastCommand = newCommands[newCommands.length - 1];
        if (lastCommand && lastCommand.canMerge && lastCommand.canMerge(command)) {
          // Merge commands
          const mergedCommand = lastCommand.merge!(command);
          newCommands[newCommands.length - 1] = mergedCommand;
        } else {
          // Add new command
          newCommands.push(command);
          newIndex++;
        }
        
        // Limit history size
        if (newCommands.length > maxHistorySize) {
          const removeCount = newCommands.length - maxHistorySize;
          newCommands = newCommands.slice(removeCount);
          newIndex = Math.max(0, newIndex - removeCount);
        }
        
        const newHistory = updateAvailability({
          ...prevHistory,
          commands: newCommands,
          currentIndex: newIndex
        });
        
        return newHistory;
      });
      
      setLastCommand(command);
    } catch (error) {
      console.error('[useUndoRedo] Command execution failed:', error);
    } finally {
      setIsExecuting(false);
    }
  }, [maxHistorySize, updateAvailability]);

  // Undo the last command
  const undo = useCallback(() => {
    if (isExecutingRef.current || !historyRef.current.canUndo) {
      return;
    }

    setIsExecuting(true);
    
    try {
      const currentHistory = historyRef.current;
      const commandToUndo = currentHistory.commands[currentHistory.currentIndex];
      
      if (commandToUndo) {
        commandToUndo.undo();
        
        setHistory(prevHistory => {
          const newHistory = updateAvailability({
            ...prevHistory,
            currentIndex: prevHistory.currentIndex - 1
          });
          return newHistory;
        });
      }
    } catch (error) {
      console.error('[useUndoRedo] Undo failed:', error);
    } finally {
      setIsExecuting(false);
    }
  }, [updateAvailability]);

  // Redo the next command
  const redo = useCallback(() => {
    if (isExecutingRef.current || !historyRef.current.canRedo) {
      return;
    }

    setIsExecuting(true);
    
    try {
      const currentHistory = historyRef.current;
      const commandToRedo = currentHistory.commands[currentHistory.currentIndex + 1];
      
      if (commandToRedo) {
        commandToRedo.execute();
        
        setHistory(prevHistory => {
          const newHistory = updateAvailability({
            ...prevHistory,
            currentIndex: prevHistory.currentIndex + 1
          });
          return newHistory;
        });
      }
    } catch (error) {
      console.error('[useUndoRedo] Redo failed:', error);
    } finally {
      setIsExecuting(false);
    }
  }, [updateAvailability]);

  // Clear history
  const clearHistory = useCallback(() => {
    setHistory(prevHistory => updateAvailability({
      ...prevHistory,
      commands: [],
      currentIndex: -1
    }));
    setLastCommand(null);
  }, [updateAvailability]);

  // Create layout command
  const createLayoutCommand = useCallback((
    description: string,
    beforeLayouts: LayoutItem[],
    afterLayouts: LayoutItem[],
    breakpoint: string,
    onApply: (layouts: LayoutItem[]) => void
  ): LayoutCommand => {
    return {
      id: `layout_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: 'layout',
      description,
      timestamp: Date.now(),
      layoutChanges: {
        before: beforeLayouts,
        after: afterLayouts,
        breakpoint
      },
      execute: () => onApply(afterLayouts),
      undo: () => onApply(beforeLayouts),
      canMerge: (other: Command) => {
        if (other.type !== 'layout') return false;
        const otherLayout = other as LayoutCommand;
        return otherLayout.layoutChanges.breakpoint === breakpoint &&
               Date.now() - other.timestamp < 1000; // Merge within 1 second
      },
      merge: (other: Command) => {
        const otherLayout = other as LayoutCommand;
        return createLayoutCommand(
          `${description} + ${other.description}`,
          beforeLayouts,
          otherLayout.layoutChanges.after,
          breakpoint,
          onApply
        );
      }
    };
  }, []);

  // Create module configuration command
  const createModuleCommand = useCallback((
    description: string,
    moduleId: string,
    beforeConfig: ModuleConfig,
    afterConfig: ModuleConfig,
    onApply: (config: ModuleConfig) => void
  ): ModuleCommand => {
    return {
      id: `module_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: 'module',
      description,
      timestamp: Date.now(),
      moduleChanges: {
        before: beforeConfig,
        after: afterConfig,
        moduleId
      },
      execute: () => onApply(afterConfig),
      undo: () => onApply(beforeConfig),
      canMerge: (other: Command) => {
        if (other.type !== 'module') return false;
        const otherModule = other as ModuleCommand;
        return otherModule.moduleChanges.moduleId === moduleId &&
               Date.now() - other.timestamp < 1000; // Merge within 1 second
      },
      merge: (other: Command) => {
        const otherModule = other as ModuleCommand;
        return createModuleCommand(
          `${description} + ${other.description}`,
          moduleId,
          beforeConfig,
          otherModule.moduleChanges.after,
          onApply
        );
      }
    };
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    if (!enableKeyboardShortcuts) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const { ctrlKey, metaKey, shiftKey, key } = event;
      const isModifierPressed = ctrlKey || metaKey;

      if (!isModifierPressed) return;

      switch (key.toLowerCase()) {
        case 'z':
          if (shiftKey) {
            // Ctrl/Cmd + Shift + Z = Redo
            if (history.canRedo) {
              event.preventDefault();
              redo();
            }
          } else {
            // Ctrl/Cmd + Z = Undo
            if (history.canUndo) {
              event.preventDefault();
              undo();
            }
          }
          break;
        case 'y':
          // Ctrl/Cmd + Y = Redo (alternative)
          if (history.canRedo) {
            event.preventDefault();
            redo();
          }
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [enableKeyboardShortcuts, history.canUndo, history.canRedo, undo, redo]);

  // Notify state changes
  useEffect(() => {
    if (onStateChange) {
      const state: UndoRedoState = {
        history,
        isExecuting,
        lastCommand
      };
      onStateChange(state);
    }
  }, [history, isExecuting, lastCommand, onStateChange]);

  return {
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    undo,
    redo,
    executeCommand,
    history,
    clearHistory,
    createLayoutCommand,
    createModuleCommand,
    isExecuting
  };
};

export default useUndoRedo;