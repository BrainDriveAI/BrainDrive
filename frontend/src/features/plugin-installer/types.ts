export interface PluginInstallRequest {
  repo_url: string;
  version?: string;
}

export interface PluginInstallResponse {
  status: 'success' | 'error';
  message: string;
  data?: {
    plugin_id: string;
    plugin_slug: string;
    modules_created: string[];
    plugin_directory: string;
    source: string;
    repo_url: string;
    version: string;
  };
  error?: string;
}

export interface InstallationStep {
  id: string;
  label: string;
  status: 'pending' | 'in-progress' | 'completed' | 'error';
  message?: string;
  error?: string;
}

export interface PluginUpdateInfo {
  plugin_id: string;
  current_version: string;
  latest_version: string;
  repo_url: string;
}

export interface AvailableUpdatesResponse {
  status: 'success' | 'error';
  data: {
    available_updates: PluginUpdateInfo[];
    total_count: number;
  };
}

export interface ErrorDetails {
  error: string;
  step: string;
  repo_url?: string;
  version?: string;
  user_id?: string;
  plugin_slug?: string;
  exception_type?: string;
  validation_error?: string;
}

export interface PluginInstallationState {
  isInstalling: boolean;
  currentStep: number;
  steps: InstallationStep[];
  result: PluginInstallResponse | null;
  error: string | null;
  errorDetails?: ErrorDetails;
  suggestions?: string[];
}

// Plugin Testing Types
export interface PluginTestResponse {
  status: 'success' | 'error' | 'partial';
  message: string;
  details: {
    backend: BackendTestResult;
    frontend: FrontendTestResult;
    overall: OverallTestResult;
  };
}

export interface BackendTestResult {
  plugin_installed: boolean;
  files_exist: boolean;
  manifest_valid: boolean;
  bundle_accessible: boolean;
  modules_configured: ModuleConfigTest[];
  errors: string[];
  warnings: string[];
}

export interface FrontendTestResult {
  success: boolean;
  loadedModules?: number;
  moduleTests?: ModuleInstantiationTest[];
  error?: string;
}

export interface ModuleConfigTest {
  moduleName: string;
  configured: boolean;
  hasRequiredFields: boolean;
  issues: string[];
}

export interface ModuleInstantiationTest {
  moduleName: string;
  success: boolean;
  error?: string;
  componentCreated: boolean;
}

export interface OverallTestResult {
  canLoad: boolean;
  canInstantiate: boolean;
  issues: string[];
  recommendations: string[];
}

export interface PluginTestState {
  isLoading: boolean;
  result: PluginTestResponse | null;
  hasRun: boolean;
}