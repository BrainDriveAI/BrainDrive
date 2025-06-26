import { AbstractBaseService } from './base/BaseService';

export interface PageContextData {
  pageId: string;
  pageName: string;
  pageRoute: string;
  isStudioPage: boolean;
}

export interface PageContextServiceInterface {
  getCurrentPageContext(): PageContextData | null;
  onPageContextChange(callback: (context: PageContextData) => void): () => void;
}

class PageContextServiceImpl extends AbstractBaseService implements PageContextServiceInterface {
  private currentContext: PageContextData | null = null;
  private listeners: ((context: PageContextData) => void)[] = [];
  private static instance: PageContextServiceImpl;

  private constructor() {
    super(
      'pageContext',
      { major: 1, minor: 0, patch: 0 },
      [
        {
          name: 'page-context-management',
          description: 'Page context tracking and management capabilities',
          version: '1.0.0'
        },
        {
          name: 'page-context-events',
          description: 'Page context change event subscription system',
          version: '1.0.0'
        }
      ]
    );
  }

  public static getInstance(): PageContextServiceImpl {
    if (!PageContextServiceImpl.instance) {
      PageContextServiceImpl.instance = new PageContextServiceImpl();
    }
    return PageContextServiceImpl.instance;
  }

  async initialize(): Promise<void> {
    // Initialize the service - no special initialization needed for now
    console.log('[PageContextService] Initialized');
  }

  async destroy(): Promise<void> {
    // Clean up listeners
    this.listeners = [];
    this.currentContext = null;
    console.log('[PageContextService] Destroyed');
  }

  getCurrentPageContext(): PageContextData | null {
    return this.currentContext;
  }

  setPageContext(context: PageContextData): void {
    this.currentContext = context;
    this.listeners.forEach(listener => listener(context));
  }

  onPageContextChange(callback: (context: PageContextData) => void): () => void {
    this.listeners.push(callback);
    
    // Return unsubscribe function
    return () => {
      const index = this.listeners.indexOf(callback);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }
}

export const pageContextService = PageContextServiceImpl.getInstance();