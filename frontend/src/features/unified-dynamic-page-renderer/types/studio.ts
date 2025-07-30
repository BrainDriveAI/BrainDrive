/**
 * Studio Mode Types - Unified Dynamic Page Renderer
 * 
 * Types specific to studio mode functionality including drag-and-drop,
 * advanced editing, undo/redo, and collaboration features.
 */

import { RenderMode, ModuleConfig, LayoutItem } from './core';
import { BreakpointInfo } from './responsive';

// Studio Mode Features
export interface StudioModeFeatures {
  // Core editing capabilities
  dragAndDrop: boolean;
  resize: boolean;
  configure: boolean;
  delete: boolean;
  
  // UI elements
  toolbar: boolean;
  contextMenu: boolean;
  propertyPanel: boolean;
  gridOverlay: boolean;
  
  // Advanced features
  undo: boolean;
  redo: boolean;
  copy: boolean;
  paste: boolean;
  multiSelect: boolean;
  keyboardShortcuts: boolean;
  
  // Grid features
  snapToGrid: boolean;
  gridAlignment: boolean;
  collisionDetection: boolean;
  
  // Collaboration
  realTimeEditing: boolean;
  comments: boolean;
  versionHistory: boolean;
  
  // Performance
  autoSave: boolean;
  previewMode: boolean;
}

// Drag and Drop System
export interface DragDropConfig {
  enabled: boolean;
  dragThreshold: number;
  dropZoneHighlight: boolean;
  visualFeedback: boolean;
  constrainToParent: boolean;
  snapToGrid: boolean;
  snapThreshold: number;
}

export interface DragData {
  type: 'module' | 'layout-item';
  pluginId: string;
  moduleId: string;
  moduleName: string;
  displayName?: string;
  isLocal: boolean;
  layout?: ModuleLayoutHints;
  config?: ModuleConfig;
  metadata?: Record<string, any>;
}

export interface ModuleLayoutHints {
  defaultWidth?: number;
  defaultHeight?: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  aspectRatio?: number;
  resizable?: boolean;
  draggable?: boolean;
}

export interface DropZoneValidation {
  isValid: boolean;
  reason?: string;
  suggestions?: string[];
}

export interface DragDropState {
  isDragging: boolean;
  dragData: DragData | null;
  dropZones: DropZone[];
  activeDropZone: string | null;
  dragPreview: DragPreview | null;
}

export interface DropZone {
  id: string;
  element: HTMLElement;
  bounds: DOMRect;
  accepts: string[];
  validation?: (data: DragData) => DropZoneValidation;
}

export interface DragPreview {
  element: HTMLElement;
  offset: { x: number; y: number };
  style: CSSStyleDeclaration;
}

// Advanced Editing Features
export interface MultiSelectState {
  enabled: boolean;
  selectedItems: string[];
  selectionBounds: DOMRect | null;
  selectionMode: 'single' | 'multiple' | 'range';
}

export interface ClipboardData {
  type: 'layout-items';
  items: LayoutItem[];
  metadata: {
    timestamp: number;
    source: string;
    breakpoint: string;
  };
}

export interface KeyboardShortcut {
  key: string;
  modifiers: ('ctrl' | 'alt' | 'shift' | 'meta')[];
  action: string;
  description: string;
  handler: () => void;
}

// Undo/Redo System
export interface Command {
  id: string;
  type: string;
  description: string;
  timestamp: number;
  execute: () => void;
  undo: () => void;
  canMerge?: (other: Command) => boolean;
  merge?: (other: Command) => Command;
}

export interface CommandHistory {
  commands: Command[];
  currentIndex: number;
  maxSize: number;
  canUndo: boolean;
  canRedo: boolean;
}

export interface UndoRedoState {
  history: CommandHistory;
  isExecuting: boolean;
  lastCommand: Command | null;
}

// Layout Commands
export interface LayoutCommand extends Command {
  layoutChanges: {
    before: LayoutItem[];
    after: LayoutItem[];
    breakpoint: string;
  };
}

export interface ModuleCommand extends Command {
  moduleChanges: {
    before: ModuleConfig;
    after: ModuleConfig;
    moduleId: string;
  };
}

// Grid Editing
export interface GridEditingState {
  snapToGrid: boolean;
  gridSize: number;
  showGrid: boolean;
  alignmentGuides: boolean;
  collisionDetection: boolean;
  autoArrange: boolean;
}

export interface GridAlignment {
  horizontal: 'left' | 'center' | 'right';
  vertical: 'top' | 'middle' | 'bottom';
}

export interface AlignmentGuide {
  id: string;
  type: 'horizontal' | 'vertical';
  position: number;
  items: string[];
  visible: boolean;
}

// Studio Context
export interface StudioContext {
  mode: RenderMode;
  features: StudioModeFeatures;
  breakpoint: BreakpointInfo;
  
  // State
  dragDropState: DragDropState;
  multiSelectState: MultiSelectState;
  undoRedoState: UndoRedoState;
  gridEditingState: GridEditingState;
  
  // Actions
  actions: StudioActions;
}

export interface StudioActions {
  // Mode management
  switchMode: (mode: RenderMode) => void;
  toggleFeature: (feature: keyof StudioModeFeatures) => void;
  
  // Drag and drop
  startDrag: (data: DragData, event: DragEvent) => void;
  endDrag: () => void;
  handleDrop: (data: DragData, position: { x: number; y: number }) => void;
  
  // Selection
  selectItem: (itemId: string, addToSelection?: boolean) => void;
  selectMultiple: (itemIds: string[]) => void;
  clearSelection: () => void;
  
  // Editing
  copyItems: (itemIds: string[]) => void;
  pasteItems: (position?: { x: number; y: number }) => void;
  deleteItems: (itemIds: string[]) => void;
  duplicateItems: (itemIds: string[]) => void;
  
  // Layout
  moveItems: (itemIds: string[], delta: { x: number; y: number }) => void;
  resizeItem: (itemId: string, size: { w: number; h: number }) => void;
  alignItems: (itemIds: string[], alignment: GridAlignment) => void;
  
  // Undo/Redo
  undo: () => void;
  redo: () => void;
  executeCommand: (command: Command) => void;
  
  // Grid
  toggleGrid: () => void;
  setGridSize: (size: number) => void;
  snapToGrid: (position: { x: number; y: number }) => { x: number; y: number };
}

// Studio Events
export interface StudioEvent {
  type: string;
  timestamp: number;
  data: any;
}

export interface StudioModeChangeEvent extends StudioEvent {
  type: 'mode-change';
  data: {
    fromMode: RenderMode;
    toMode: RenderMode;
  };
}

export interface StudioItemSelectEvent extends StudioEvent {
  type: 'item-select';
  data: {
    itemId: string;
    multiSelect: boolean;
  };
}

export interface StudioLayoutChangeEvent extends StudioEvent {
  type: 'layout-change';
  data: {
    items: LayoutItem[];
    breakpoint: string;
    source: 'drag' | 'resize' | 'command';
  };
}

export interface StudioCommandEvent extends StudioEvent {
  type: 'command-execute' | 'command-undo' | 'command-redo';
  data: {
    command: Command;
  };
}

// Collaboration Features
export interface CollaborationState {
  enabled: boolean;
  sessionId: string;
  userId: string;
  collaborators: Collaborator[];
  cursors: CollaboratorCursor[];
  selections: CollaboratorSelection[];
}

export interface Collaborator {
  id: string;
  name: string;
  avatar?: string;
  color: string;
  isActive: boolean;
  lastSeen: Date;
}

export interface CollaboratorCursor {
  userId: string;
  position: { x: number; y: number };
  visible: boolean;
}

export interface CollaboratorSelection {
  userId: string;
  itemIds: string[];
  color: string;
}

export interface Comment {
  id: string;
  userId: string;
  content: string;
  position: { x: number; y: number };
  itemId?: string;
  timestamp: Date;
  resolved: boolean;
  replies: CommentReply[];
}

export interface CommentReply {
  id: string;
  userId: string;
  content: string;
  timestamp: Date;
}

// Version History
export interface Version {
  id: string;
  name: string;
  description?: string;
  timestamp: Date;
  userId: string;
  snapshot: {
    layouts: any;
    modules: any;
    metadata: any;
  };
  tags: string[];
}

export interface VersionHistory {
  versions: Version[];
  currentVersion: string;
  canRevert: boolean;
}

// Studio Configuration
export interface StudioConfig {
  features: Partial<StudioModeFeatures>;
  dragDrop: Partial<DragDropConfig>;
  grid: Partial<GridEditingState>;
  shortcuts: KeyboardShortcut[];
  collaboration: {
    enabled: boolean;
    serverUrl?: string;
    autoSave: boolean;
    conflictResolution: 'manual' | 'auto-merge' | 'last-write-wins';
  };
  ui: {
    theme: 'light' | 'dark' | 'auto';
    density: 'compact' | 'normal' | 'comfortable';
    animations: boolean;
    tooltips: boolean;
  };
}

// Studio Hooks Return Types
export interface UseStudioModeReturn {
  mode: RenderMode;
  features: StudioModeFeatures;
  isTransitioning: boolean;
  switchMode: (mode: RenderMode) => Promise<void>;
  toggleFeature: (feature: keyof StudioModeFeatures) => void;
  isFeatureEnabled: (feature: keyof StudioModeFeatures) => boolean;
}

export interface UseDragDropReturn {
  dragDropState: DragDropState;
  startDrag: (data: DragData, event: DragEvent) => void;
  endDrag: () => void;
  handleDrop: (data: DragData, position: { x: number; y: number }) => void;
  registerDropZone: (element: HTMLElement) => () => void;
  registerDragSource: (element: HTMLElement) => () => void;
  isDragActive: boolean;
  isActiveDropZone: boolean;
  createValidation: (acceptedTypes: string[], customValidation?: (data: DragData) => DropZoneValidation) => (data: DragData) => DropZoneValidation;
}

export interface UseUndoRedoReturn {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  executeCommand: (command: Command) => void;
  history: CommandHistory;
  clearHistory: () => void;
  createLayoutCommand: (
    description: string,
    beforeLayouts: any[],
    afterLayouts: any[],
    breakpoint: string,
    onApply: (layouts: any[]) => void
  ) => LayoutCommand;
  createModuleCommand: (
    description: string,
    moduleId: string,
    beforeConfig: any,
    afterConfig: any,
    onApply: (config: any) => void
  ) => ModuleCommand;
  isExecuting: boolean;
}

export interface UseAdvancedEditingReturn {
  multiSelectState: MultiSelectState;
  selectItem: (itemId: string, addToSelection?: boolean) => void;
  selectMultiple: (itemIds: string[]) => void;
  clearSelection: () => void;
  copyItems: (itemIds: string[]) => void;
  pasteItems: (position?: { x: number; y: number }) => void;
  deleteItems: (itemIds: string[]) => void;
  duplicateItems: (itemIds: string[]) => void;
  clipboardData: ClipboardData | null;
}