import { HashRouter,BrowserRouter } from 'react-router-dom';
import { CssBaseline, ThemeProvider } from '@mui/material';
import { PageStateProvider } from './contexts/PageStateContext';
import { ModuleStateProvider } from './contexts/ModuleStateContext';
import { ServiceProvider } from './contexts/ServiceContext';
import { PluginStudioDevModeProvider } from './contexts/PluginStudioDevModeContext';
import { ServiceRegistry } from './services/ServiceRegistry';
import ApiService from './services/ApiService';
import { themeService } from './services/themeService';
import { SettingsService } from './services/SettingsService';
import { UserSettingsInitService } from './services/UserSettingsInitService';
import { userNavigationInitService } from './services/UserNavigationInitService';
import { eventService } from './services/EventService';
import { pageContextService } from './services/PageContextService';
import { pluginStateFactory } from './services/PluginStateFactory';
import { databasePersistenceManager } from './services/DatabasePersistenceManager';
import { stateRestorationManager } from './services/StateRestorationManager';
import { pluginStateLifecycleManager } from './services/PluginStateLifecycleManager';
import { useAppTheme } from './hooks/useAppTheme';
import { config } from './config';
import { PluginManager } from './components/PluginManager';
import { AuthProvider } from './contexts/AuthContext';
import AppRoutes from './routes';


const isElectron = window?.process?.versions?.electron;
const Router = isElectron ? HashRouter : BrowserRouter;


// Initialize service registry
const serviceRegistry = new ServiceRegistry({
  allowOverrides: false,
  validateDependencies: true
});

// Register services
const apiService = ApiService.getInstance();
const settingsService = new SettingsService();
const userSettingsInitService = new UserSettingsInitService(settingsService);

serviceRegistry.registerService(apiService);
serviceRegistry.registerService(themeService);
serviceRegistry.registerService(settingsService);
serviceRegistry.registerService(userSettingsInitService);
serviceRegistry.registerService(userNavigationInitService);
serviceRegistry.registerService(eventService);
serviceRegistry.registerService(pageContextService);
serviceRegistry.registerService(pluginStateFactory);
serviceRegistry.registerService(databasePersistenceManager);
serviceRegistry.registerService(stateRestorationManager);
serviceRegistry.registerService(pluginStateLifecycleManager);

function AppContent() {
  const theme = useAppTheme();

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <PluginManager>
        <AppRoutes />
      </PluginManager>
    </ThemeProvider>
  );
}

function App() {
  return (
    <Router>
      <PluginStudioDevModeProvider>
        <ServiceProvider registry={serviceRegistry}>
          <PageStateProvider>
            <ModuleStateProvider>
              <AuthProvider>
                <AppContent />
              </AuthProvider>
            </ModuleStateProvider>
          </PageStateProvider>
        </ServiceProvider>
      </PluginStudioDevModeProvider>
    </Router>
  );
}

export default App;
