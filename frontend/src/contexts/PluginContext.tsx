import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { PluginMessage, PluginConnection, DynamicPluginConfig, MessageSchema } from '../types/index';
import { getPluginConfigForInstance, getModuleConfigForInstance, onPluginRegistryChange, getPluginIdFromInstanceId } from '../plugins';

interface PluginContextType {
  connections: PluginConnection[];
  messages: Record<string, PluginMessage[]>;
  addConnection: (from: string, to: string, messageTypes: string[], moduleId?: string) => void;
  removeConnection: (from: string, to: string, moduleId?: string) => void;
  sendMessage: (from: string, message: PluginMessage, to?: string, moduleId?: string) => void;
  getPluginMessages: (instanceId: string, moduleId?: string) => PluginMessage[];
  getModuleMessageSchemas: (pluginId: string, moduleId: string) => { sends?: MessageSchema[], receives?: MessageSchema[] } | null;
}

const PluginContext = createContext<PluginContextType | null>(null);

// Export the context
export { PluginContext };

export const PluginProvider: React.FC<{ 
  children: React.ReactNode;
  plugins: DynamicPluginConfig[];
}> = ({ children, plugins }) => {
  const [availablePlugins, setAvailablePlugins] = useState<DynamicPluginConfig[]>(plugins);
  const [connections, setConnections] = useState<PluginConnection[]>([]);
  const [messages, setMessages] = useState<Record<string, PluginMessage[]>>({});
  const messageIdCounter = useRef(0);

  // Listen for plugin registry changes
  useEffect(() => {
    const unsubscribe = onPluginRegistryChange(() => {
      // Update available plugins when the registry changes
      setAvailablePlugins([...plugins]);
    });
    
    return () => unsubscribe();
  }, [plugins]);

  const addConnection = useCallback((from: string, to: string, messageTypes: string[], moduleId?: string) => {
    console.log('PluginContext - addConnection called:', { from, to, messageTypes, moduleId });
    
    if (from === to) {
      console.warn('Attempted to create self-connection:', { from, to });
      return;
    }

    // Validate instance IDs
    const fromPlugin = getPluginConfigForInstance(from);
    const toPlugin = getPluginConfigForInstance(to);
    
    if (!fromPlugin || !toPlugin) {
      console.error('Invalid instance ID in connection:', { 
        from, 
        to, 
        fromValid: !!fromPlugin,
        toValid: !!toPlugin
      });
      return;
    }

    // Check if connection already exists
    const existingConnection = connections.find(conn => 
      conn.from === from && 
      conn.to === to && 
      (moduleId === undefined || conn.moduleId === moduleId)
    );

    if (existingConnection) {
      console.log('PluginContext - Connection already exists, updating messageTypes:', { 
        from, 
        to, 
        oldTypes: existingConnection.messageTypes,
        newTypes: messageTypes
      });
      
      // Update existing connection
      setConnections(prev => 
        prev.map(conn => 
          (conn.from === from && conn.to === to && (moduleId === undefined || conn.moduleId === moduleId))
            ? { ...conn, messageTypes: Array.from(new Set([...conn.messageTypes, ...messageTypes])) }
            : conn
        )
      );
    } else {
      console.log('PluginContext - Creating new connection:', { from, to, messageTypes, moduleId });
      
      // Create new connection
      setConnections(prev => [
        ...prev,
        { from, to, messageTypes, moduleId }
      ]);
    }
  }, [connections]);

  const removeConnection = useCallback((from: string, to: string, moduleId?: string) => {
    setConnections(prev => 
      prev.filter(conn => !(conn.from === from && conn.to === to && conn.moduleId === moduleId))
    );
  }, []);

  const processMessage = useCallback((from: string, message: PluginMessage, to?: string, moduleId?: string) => {
    console.log('PluginContext - processMessage called:', { from, to, moduleId, messageType: message.type });
    
    // Validate message against schema if available
    if (to) {
      const toPlugin = getPluginConfigForInstance(to);
      if (toPlugin) {
        // If moduleId is provided, validate against module schema
        if (moduleId) {
          const moduleConfig = getModuleConfigForInstance(to, moduleId);
          if (moduleConfig && moduleConfig.messages && moduleConfig.messages.receives) {
            const schema = moduleConfig.messages.receives.find(s => s.type === message.type);
            if (schema && schema.fields) {
              // Validate required fields
              const missingFields = schema.fields
                .filter(field => field.required)
                .filter(field => {
                  const value = message.content[field.name];
                  return value === undefined || value === null;
                })
                .map(field => field.name);
              
              if (missingFields.length > 0) {
                console.error(`Message validation failed: Missing required fields: ${missingFields.join(', ')}`, message);
                return; // Don't send invalid messages
              }
            }
          }
        }
      }
    }

    // Find connections that should receive this message
    connections.forEach(conn => {
      // Check if this connection matches the sender, target, and module
      if (conn.from === from && (!to || conn.to === to) && 
          // If moduleId is specified in the connection, it must match
          (conn.moduleId === undefined || conn.moduleId === moduleId)) {
        if (conn.messageTypes.includes(message.type)) {
          console.log('PluginContext - Message sent through connection:', { 
            from, 
            to: conn.to, 
            messageType: message.type,
            moduleId
          });
        } else {
          console.log('PluginContext - Message type not in connection messageTypes:', {
            messageType: message.type,
            allowedTypes: conn.messageTypes
          });
        }
      } else {
        console.log('PluginContext - Connection did not match:', {
          connection: conn,
          messageFrom: from,
          messageTo: to,
          messageModuleId: moduleId
        });
      }
    });
  }, [connections]);

  const sendMessage = useCallback((from: string, message: PluginMessage, to?: string, moduleId?: string) => {
    console.log('PluginContext - sendMessage called:', { from, to, moduleId, messageType: message.type });
    
    // Resolve the pluginId for the target instance
    let targetPluginId = to;
    if (to) {
      const targetConfig = getPluginConfigForInstance(to);
      if (targetConfig) {
        targetPluginId = targetConfig.id;
      }
    }
    
    // Resolve the pluginId for the source instance
    const sourceConfig = getPluginConfigForInstance(from);
    const sourcePluginId = sourceConfig?.id || from;
    
    // Enrich the message with metadata
    const enrichedMessage = {
      ...message,
      metadata: {
        ...(message.metadata || {}),
        from,
        to,
        timestamp: new Date().toISOString(),
        moduleId
      }
    };
    
    // Add message to sender's messages
    setMessages(prevMessages => {
      const newMessages = { ...prevMessages };
      
      // Add to sender's instance messages
      if (!newMessages[from]) {
        newMessages[from] = [];
      }
      newMessages[from] = [...newMessages[from], enrichedMessage];
      console.log('PluginContext - added message to sender\'s (' + from + ') messages');
      
      // Add to target's instance messages if specified
      if (to) {
        if (!newMessages[to]) {
          newMessages[to] = [];
        }
        newMessages[to] = [...newMessages[to], enrichedMessage];
        console.log('PluginContext - added message to target\'s instance (' + to + ') messages');
      }
      
      // Add to target's plugin type messages if different from instance
      if (targetPluginId && targetPluginId !== to) {
        if (!newMessages[targetPluginId]) {
          newMessages[targetPluginId] = [];
        }
        newMessages[targetPluginId] = [...newMessages[targetPluginId], enrichedMessage];
        console.log('PluginContext - added message to target\'s plugin type (' + targetPluginId + ') messages');
      }
      
      console.log('PluginContext - updated messages state:', newMessages);
      
      // Force a re-render by returning a new object
      return { ...newMessages };
    });
    
    // Process the message through connections
    processMessage(from, enrichedMessage, to, moduleId);
    
    return enrichedMessage;
  }, [processMessage]);

  const getPluginMessages = useCallback((instanceId: string, moduleId?: string) => {
    console.log('PluginContext - getPluginMessages called:', { instanceId, moduleId });
    console.log('PluginContext - current messages state:', messages);
    
    // First try to get messages for the specific instance
    if (messages[instanceId]) {
      console.log('PluginContext - found', messages[instanceId].length, 'messages for instance', instanceId);
      return messages[instanceId];
    }
    
    // If no instance-specific messages, try to get messages for the plugin type
    // Get the plugin ID from the instance ID
    const pluginId = getPluginIdFromInstanceId(instanceId);
    if (pluginId && messages[pluginId]) {
      console.log('PluginContext - found', messages[pluginId].length, 'messages for plugin type', pluginId);
      return messages[pluginId];
    }
    
    // If we still don't have messages, return an empty array
    console.log('PluginContext - no messages found for', instanceId);
    return [];
  }, [messages]);

  const getModuleMessageSchemas = useCallback((pluginId: string, moduleId: string) => {
    // First try to get the module config directly
    const moduleConfig = getModuleConfigForInstance(pluginId, moduleId);
    if (!moduleConfig) {
      console.error('Module not found:', { pluginId, moduleId });
      return null;
    }
    
    // Return the module's message schemas
    return moduleConfig.messages || null;
  }, []);

  const value = {
    connections,
    messages,
    addConnection,
    removeConnection,
    sendMessage,
    getPluginMessages,
    getModuleMessageSchemas
  };

  return (
    <PluginContext.Provider value={value}>
      {children}
    </PluginContext.Provider>
  );
};

export const usePlugin = (pluginId: string) => {
  const context = useContext(PluginContext);
  if (!context) {
    throw new Error('usePlugin must be used within a PluginProvider');
  }

  const { addConnection, removeConnection, sendMessage, getPluginMessages, getModuleMessageSchemas } = context;

  return {
    messages: getPluginMessages(pluginId),
    sendMessage: (message: PluginMessage, to?: string) => sendMessage(pluginId, message, to),
    addConnection: (to: string, messageTypes: string[]) => addConnection(pluginId, to, messageTypes),
    removeConnection: (to: string) => removeConnection(pluginId, to),
    getModuleMessageSchemas: (moduleId: string) => getModuleMessageSchemas(pluginId, moduleId)
  };
};

export const usePluginModule = (pluginId: string, moduleId?: string) => {
  const context = useContext(PluginContext);
  console.log('usePluginModule - pluginId:', pluginId, 'moduleId:', moduleId);
  
  if (!context) {
    throw new Error('usePluginModule must be used within a PluginProvider');
  }
  
  const { addConnection, removeConnection, sendMessage, getPluginMessages, getModuleMessageSchemas } = context;
  
  // If moduleId is empty, we'll use plugin-level messaging
  if (!moduleId) {
    console.log('usePluginModule - moduleId is empty, using plugin-level messaging');
    
    // Get messages for this plugin
    const messages = getPluginMessages(pluginId);
    
    // Create wrapped functions that include the pluginId
    const wrappedAddConnection = useCallback((to: string, messageTypes: string[] = []) => {
      console.log("usePluginModule - wrappedAddConnection called:", { to, messageTypes, pluginId });
      return addConnection(pluginId, to, messageTypes);
    }, [addConnection, pluginId]);
    
    const wrappedRemoveConnection = useCallback((to: string) => {
      console.log("usePluginModule - wrappedRemoveConnection called:", { to, pluginId });
      return removeConnection(pluginId, to);
    }, [removeConnection, pluginId]);
    
    const wrappedSendMessage = useCallback((message: any, to?: string) => {
      console.log("usePluginModule - wrappedSendMessage called:", { message, to, pluginId, moduleId });
      return sendMessage(pluginId, message, to);
    }, [sendMessage, pluginId]);
    
    return {
      messages,
      sendMessage: wrappedSendMessage,
      addConnection: wrappedAddConnection,
      removeConnection: wrappedRemoveConnection,
      getMessageSchemas: () => null // No schemas for plugin-level messaging
    };
  }
  
  // Get messages for this plugin/module
  const messages = getPluginMessages(pluginId, moduleId);
  const messageSchemas = getModuleMessageSchemas(pluginId, moduleId);
  
  // Create wrapped functions that include the pluginId and moduleId
  const wrappedAddConnection = useCallback((to: string, messageTypes: string[] = []) => {
    return addConnection(pluginId, to, messageTypes, moduleId);
  }, [addConnection, pluginId, moduleId]);
  
  const wrappedRemoveConnection = useCallback((to: string) => {
    return removeConnection(pluginId, to, moduleId);
  }, [removeConnection, pluginId, moduleId]);
  
  const wrappedSendMessage = useCallback((message: any, to?: string) => {
    return sendMessage(pluginId, message, to, moduleId);
  }, [sendMessage, pluginId, moduleId]);
  
  return {
    messages,
    sendMessage: wrappedSendMessage,
    addConnection: wrappedAddConnection,
    removeConnection: wrappedRemoveConnection,
    getMessageSchemas: () => messageSchemas
  };
};
