import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { DragData } from '../types/studio';
import { BreakpointInfo } from '../types/responsive';
import { useDragDrop } from '../hooks/useDragDrop';

export interface Plugin {
  id: string;
  name: string;
  description?: string;
  author?: string;
  icon?: string;
  modules: PluginModule[];
  isLocal?: boolean;
}

export interface PluginModule {
  id: string;
  name: string;
  displayName?: string;
  description?: string;
  type?: string;
  category?: string;
  icon?: string;
  tags?: string[];
  priority?: number;
  dependencies?: string[];
  layout?: {
    defaultWidth?: number;
    defaultHeight?: number;
    minWidth?: number;
    minHeight?: number;
    maxWidth?: number;
    maxHeight?: number;
  };
}

export interface StudioToolbarProps {
  plugins: Plugin[];
  breakpoint: BreakpointInfo;
  searchTerm?: string;
  groupBy?: 'plugin' | 'category';
  excludeCategories?: string[];
  
  // Responsive behavior
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  
  // Event handlers
  onSearch?: (term: string) => void;
  onGroupByChange?: (groupBy: 'plugin' | 'category') => void;
  onModuleDragStart?: (data: DragData) => void;
  
  // Customization
  className?: string;
  style?: React.CSSProperties;
}

interface GroupedModules {
  [key: string]: Array<{
    pluginId: string;
    pluginName: string;
    module: PluginModule;
    isLocal: boolean;
  }>;
}

export const StudioToolbar: React.FC<StudioToolbarProps> = ({
  plugins,
  breakpoint,
  searchTerm = '',
  groupBy = 'plugin',
  excludeCategories = ['settings'],
  collapsible = true,
  defaultCollapsed = false,
  onSearch,
  onGroupByChange,
  onModuleDragStart,
  className = '',
  style = {}
}) => {
  // State
  const [internalSearchTerm, setInternalSearchTerm] = useState(searchTerm);
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // Use external search term if provided
  const effectiveSearchTerm = onSearch ? searchTerm : internalSearchTerm;

  // Drag and drop integration
  const { registerDragSource } = useDragDrop();

  // Filter and group modules
  const groupedModules = useMemo((): GroupedModules => {
    const groups: GroupedModules = {};
    
    plugins.forEach(plugin => {
      plugin.modules.forEach(module => {
        // Filter by search term
        if (effectiveSearchTerm) {
          const searchLower = effectiveSearchTerm.toLowerCase();
          const matchesName = module.name.toLowerCase().includes(searchLower);
          const matchesDisplayName = module.displayName?.toLowerCase().includes(searchLower);
          const matchesDescription = module.description?.toLowerCase().includes(searchLower);
          const matchesTags = module.tags?.some(tag => tag.toLowerCase().includes(searchLower));
          
          if (!matchesName && !matchesDisplayName && !matchesDescription && !matchesTags) {
            return;
          }
        }
        
        // Filter by excluded categories
        if (module.category && excludeCategories.includes(module.category)) {
          return;
        }
        
        // Group by plugin or category
        const groupKey = groupBy === 'plugin' ? plugin.id : (module.category || 'General');
        
        if (!groups[groupKey]) {
          groups[groupKey] = [];
        }
        
        groups[groupKey].push({
          pluginId: plugin.id,
          pluginName: plugin.name,
          module,
          isLocal: plugin.isLocal || false
        });
      });
    });
    
    // Sort modules within each group by priority and name
    Object.keys(groups).forEach(groupKey => {
      groups[groupKey].sort((a, b) => {
        // Sort by priority first (higher priority first)
        const priorityA = a.module.priority || 0;
        const priorityB = b.module.priority || 0;
        if (priorityA !== priorityB) {
          return priorityB - priorityA;
        }
        
        // Then by display name or name
        const nameA = a.module.displayName || a.module.name;
        const nameB = b.module.displayName || b.module.name;
        return nameA.localeCompare(nameB);
      });
    });
    
    return groups;
  }, [plugins, effectiveSearchTerm, groupBy, excludeCategories]);

  // Handle search
  const handleSearch = useCallback((term: string) => {
    if (onSearch) {
      onSearch(term);
    } else {
      setInternalSearchTerm(term);
    }
  }, [onSearch]);

  // Handle group expansion
  const toggleGroup = useCallback((groupKey: string) => {
    setExpandedGroups(prev => {
      const newSet = new Set(prev);
      if (newSet.has(groupKey)) {
        newSet.delete(groupKey);
      } else {
        newSet.add(groupKey);
      }
      return newSet;
    });
  }, []);

  // Create drag data for a module
  const createDragData = useCallback((item: GroupedModules[string][0]): DragData => {
    return {
      type: 'module',
      pluginId: item.pluginId,
      moduleId: item.module.id,
      moduleName: item.module.name,
      displayName: item.module.displayName,
      isLocal: item.isLocal,
      layout: item.module.layout,
      metadata: {
        category: item.module.category,
        tags: item.module.tags,
        description: item.module.description
      }
    };
  }, []);

  // Handle drag start
  const handleDragStart = useCallback((item: GroupedModules[string][0], event: React.MouseEvent) => {
    const dragData = createDragData(item);
    onModuleDragStart?.(dragData);
    
    // Register as drag source
    const element = event.currentTarget as HTMLElement;
    registerDragSource(element);
  }, [createDragData, onModuleDragStart, registerDragSource]);

  // Get plugin info for a group
  const getPluginInfo = useCallback((groupKey: string) => {
    if (groupBy === 'plugin') {
      return plugins.find(p => p.id === groupKey);
    }
    return null;
  }, [plugins, groupBy]);

  // Responsive behavior
  const shouldCollapse = collapsible && (
    breakpoint.name === 'mobile' || 
    (breakpoint.name === 'tablet' && breakpoint.width < 900)
  );

  const isEffectivelyCollapsed = shouldCollapse || isCollapsed;

  // Auto-expand first group if none are expanded
  useEffect(() => {
    if (expandedGroups.size === 0 && Object.keys(groupedModules).length > 0) {
      const firstGroup = Object.keys(groupedModules)[0];
      setExpandedGroups(new Set([firstGroup]));
    }
  }, [groupedModules, expandedGroups.size]);

  return (
    <div 
      className={`studio-toolbar ${className} ${isEffectivelyCollapsed ? 'studio-toolbar--collapsed' : ''}`}
      style={style}
      data-breakpoint={breakpoint.name}
    >
      {/* Header */}
      <div className="studio-toolbar__header">
        <div className="studio-toolbar__title">
          {collapsible && (
            <button
              className="studio-toolbar__collapse-button"
              onClick={() => setIsCollapsed(!isCollapsed)}
              aria-label={isCollapsed ? 'Expand toolbar' : 'Collapse toolbar'}
            >
              {isCollapsed ? '▶' : '◀'}
            </button>
          )}
          <h3>Plugins</h3>
        </div>
        
        {!isEffectivelyCollapsed && (
          <button
            className="studio-toolbar__group-toggle"
            onClick={() => {
              const newGroupBy = groupBy === 'plugin' ? 'category' : 'plugin';
              onGroupByChange?.(newGroupBy);
            }}
            title={`Group by ${groupBy === 'plugin' ? 'category' : 'plugin'}`}
          >
            {groupBy === 'plugin' ? '📁' : '🔌'}
          </button>
        )}
      </div>

      {!isEffectivelyCollapsed && (
        <>
          {/* Search */}
          <div className="studio-toolbar__search">
            <input
              type="text"
              placeholder="Search modules..."
              value={effectiveSearchTerm}
              onChange={(e) => handleSearch(e.target.value)}
              className="studio-toolbar__search-input"
            />
            {effectiveSearchTerm && (
              <button
                className="studio-toolbar__search-clear"
                onClick={() => handleSearch('')}
                aria-label="Clear search"
              >
                ✕
              </button>
            )}
          </div>

          {/* Module Groups */}
          <div className="studio-toolbar__groups">
            {Object.keys(groupedModules).length === 0 ? (
              <div className="studio-toolbar__empty">
                No modules found
              </div>
            ) : (
              Object.entries(groupedModules).map(([groupKey, items]) => {
                const pluginInfo = getPluginInfo(groupKey);
                const isExpanded = expandedGroups.has(groupKey);
                
                return (
                  <div key={groupKey} className="studio-toolbar__group">
                    <button
                      className="studio-toolbar__group-header"
                      onClick={() => toggleGroup(groupKey)}
                      title={
                        groupBy === 'plugin' && pluginInfo
                          ? `${pluginInfo.name}\n${pluginInfo.description || 'No description'}\nAuthor: ${pluginInfo.author || 'Unknown'}`
                          : `Category: ${groupKey}`
                      }
                    >
                      <span className="studio-toolbar__group-icon">
                        {isExpanded ? '▼' : '▶'}
                      </span>
                      <span className="studio-toolbar__group-name">
                        {groupBy === 'plugin' && pluginInfo ? pluginInfo.name : groupKey}
                      </span>
                      <span className="studio-toolbar__group-count">
                        ({items.length})
                      </span>
                    </button>

                    {isExpanded && (
                      <div className="studio-toolbar__modules">
                        {items.map((item, index) => (
                          <div
                            key={`${item.pluginId}-${item.module.id}-${index}`}
                            className={`studio-toolbar__module ${item.isLocal ? 'studio-toolbar__module--local' : 'studio-toolbar__module--remote'}`}
                            draggable
                            onMouseDown={(e) => handleDragStart(item, e)}
                            title={`${item.module.displayName || item.module.name}\n${item.module.description || 'No description'}\nType: ${item.module.type || 'Unknown'}\nFrom: ${item.pluginName}`}
                          >
                            <div className="studio-toolbar__module-icon">
                              {item.module.icon || '🧩'}
                            </div>
                            <div className="studio-toolbar__module-info">
                              <div className="studio-toolbar__module-name">
                                {item.module.displayName || item.module.name}
                              </div>
                              {item.module.type && (
                                <div className="studio-toolbar__module-type">
                                  {item.module.type}
                                </div>
                              )}
                              {item.module.tags && item.module.tags.length > 0 && (
                                <div className="studio-toolbar__module-tags">
                                  {item.module.tags.slice(0, 2).map(tag => (
                                    <span key={tag} className="studio-toolbar__module-tag">
                                      {tag}
                                    </span>
                                  ))}
                                  {item.module.tags.length > 2 && (
                                    <span className="studio-toolbar__module-tag-more">
                                      +{item.module.tags.length - 2}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                            {item.module.priority && item.module.priority > 0 && (
                              <div className="studio-toolbar__module-priority">
                                ⭐
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default StudioToolbar;