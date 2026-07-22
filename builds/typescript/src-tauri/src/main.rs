#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

pub mod tailscale_access;
pub mod tailscale_runtime;

use serde::{Deserialize, Serialize};
use serde_json::json;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    net::{Shutdown, TcpListener, TcpStream, UdpSocket},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};
use tailscale_access::{
    current_supported_platform, discover_tailscale, load_state as load_tailscale_state,
    save_state_atomic as save_tailscale_state, state_path as tailscale_state_path, CapturedOutput,
    CommandExitCategory, DiagnosticEvent, DiscoveryError, RunLimits, RunnerError, StateErrorCode,
    StateLoad, SystemTailscaleRunner, TailscaleAccessConfig, TailscaleAccessStatus,
    TailscaleCommand, TailscaleCommandKind, TailscaleErrorCode, TailscaleRunner,
    MANAGED_LOOPBACK_PORT_END, MANAGED_LOOPBACK_PORT_START,
};
use tailscale_runtime::{
    not_started_status as tailscale_not_started_status, perform as perform_tailscale_operation,
    shutdown as shutdown_tailscale_runtime, DeploymentMode, LifecycleAction,
    TailscaleRuntimeBackend,
};
use tauri::{path::BaseDirectory, Manager, State};
use uuid::Uuid;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;
const BROWSER_ACCESS_DEFAULT_PORT: u16 = 18088;
const BROWSER_ACCESS_FALLBACK_END_PORT: u16 = 18107;
const FIREWALL_RULE_NAME: &str = "BrainDrive Browser Access";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeStatus {
    state: String,
    gateway_base_url: String,
    desktop_api_token: String,
    services: Vec<ServiceStatus>,
    data_root: String,
    log_root: String,
    browser_access: BrowserAccessStatus,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ServiceStatus {
    id: String,
    state: String,
    port: u16,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct BrowserAccessSettings {
    enabled: bool,
    network_scope: BrowserAccessNetworkScope,
    port: u16,
    bind_address: String,
    transport_secret: String,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
enum BrowserAccessNetworkScope {
    ThisComputer,
    PrivateNetwork,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BrowserAccessSettingsUpdate {
    enabled: bool,
    network_scope: BrowserAccessNetworkScope,
    port: u16,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BrowserAccessStatus {
    enabled: bool,
    state: String,
    network_scope: BrowserAccessNetworkScope,
    bind_address: String,
    requested_port: u16,
    port: Option<u16>,
    urls: Vec<String>,
    config_path: String,
    firewall_hint: String,
    last_error: Option<String>,
    account_initialized: Option<bool>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FirewallRuleResult {
    ok: bool,
    message: String,
    command: String,
}

struct RuntimeStartup {
    status: RuntimeStatus,
    children: Vec<Child>,
    bridge_child: Option<Child>,
    tailnet_bridge_child: Option<Child>,
    tailscale_status: TailscaleAccessStatus,
    context: RuntimeContext,
}

#[derive(Clone)]
struct RuntimeContext {
    node: PathBuf,
    typescript_root: PathBuf,
    web_root: PathBuf,
    gateway_base_url: String,
    desktop_api_token: String,
    internal_transport_token: String,
    config_root: PathBuf,
    log_root: PathBuf,
}

struct DesktopTailscaleBackend<'a> {
    context: &'a RuntimeContext,
    bridge_child: &'a mut Option<Child>,
    mutation_evidence: Option<(TailscaleCommandKind, CommandExitCategory)>,
}

impl TailscaleRuntimeBackend for DesktopTailscaleBackend<'_> {
    fn deployment_mode(&self) -> DeploymentMode {
        DeploymentMode::Local
    }

    fn owner_initialized(&mut self) -> Result<bool, TailscaleErrorCode> {
        gateway_account_initialized(self.context).map_err(|_| TailscaleErrorCode::Internal)
    }

    fn load_state(&mut self) -> Result<StateLoad, StateErrorCode> {
        load_tailscale_state(&tailscale_state_path(&self.context.config_root))
    }

    fn save_state(&mut self, state: &TailscaleAccessConfig) -> Result<(), StateErrorCode> {
        save_tailscale_state(&tailscale_state_path(&self.context.config_root), state)
    }

    fn run_command(
        &mut self,
        command: &TailscaleCommand,
        limits: RunLimits,
    ) -> Result<CapturedOutput, RunnerError> {
        let platform = current_supported_platform().ok_or(RunnerError::ExecutableMissing)?;
        let executable = discover_tailscale(platform).map_err(|error| match error {
            DiscoveryError::Missing => RunnerError::ExecutableMissing,
            DiscoveryError::PermissionDenied => RunnerError::PermissionDenied,
        })?;
        let result = SystemTailscaleRunner.run(&executable, command, limits);
        if command.is_mutating() {
            let category = match &result {
                Ok(output) if output.exit_code == Some(0) => CommandExitCategory::Success,
                Ok(_) | Err(RunnerError::Timeout) => CommandExitCategory::Ambiguous,
                Err(RunnerError::OutputTooLarge) => CommandExitCategory::OutputTooLarge,
                Err(_) => CommandExitCategory::SpawnFailure,
            };
            self.mutation_evidence = Some((command.kind(), category));
        }
        result
    }

    fn bridge_healthy(&mut self, port: u16) -> bool {
        child_is_running(self.bridge_child) && http_health_ok(port, "/healthz")
    }

    fn bridge_running(&mut self) -> bool {
        child_is_running(self.bridge_child)
    }

    fn start_bridge(
        &mut self,
        preferred_port: Option<u16>,
        quarantined_port: Option<u16>,
    ) -> Result<u16, TailscaleErrorCode> {
        stop_child_checked(self.bridge_child).map_err(|_| TailscaleErrorCode::BridgeUnavailable)?;
        let port = select_tailnet_bridge_port(preferred_port, quarantined_port)
            .ok_or(TailscaleErrorCode::BridgeUnavailable)?;
        let mut child = spawn_tailnet_bridge(self.context, port)
            .map_err(|_| TailscaleErrorCode::BridgeUnavailable)?;
        if let Err(error) =
            wait_for_health(port, "/healthz", "tailscale-access", &self.context.log_root)
        {
            let _ = child.kill();
            let _ = child.wait();
            append_supervisor_log(
                &self.context.log_root,
                &format!("tailscale access bridge health failure: {error}"),
            );
            return Err(TailscaleErrorCode::BridgeUnavailable);
        }
        *self.bridge_child = Some(child);
        Ok(port)
    }

    fn stop_bridge(&mut self) -> Result<(), TailscaleErrorCode> {
        stop_child_checked(self.bridge_child).map_err(|_| TailscaleErrorCode::BridgeUnavailable)
    }

    fn record_diagnostic(&mut self, event: &DiagnosticEvent) {
        append_supervisor_log(&self.context.log_root, &event.to_json_line());
    }

    fn mutation_evidence(&self) -> Option<(TailscaleCommandKind, CommandExitCategory)> {
        self.mutation_evidence
    }
}

struct RuntimeManager {
    inner: Mutex<RuntimeInner>,
    tailscale_operations: Mutex<()>,
}

struct LaunchState {
    inner: Mutex<LaunchInner>,
}

struct LaunchInner {
    frontend_ready: bool,
    runtime_finished: bool,
    main_shown: bool,
}

struct RuntimeInner {
    status: RuntimeStatus,
    children: Vec<Child>,
    bridge_child: Option<Child>,
    tailnet_bridge_child: Option<Child>,
    tailscale_status: TailscaleAccessStatus,
    tailscale_operation: Option<String>,
    context: Option<RuntimeContext>,
}

impl RuntimeManager {
    fn new() -> Self {
        Self {
            inner: Mutex::new(RuntimeInner {
                status: RuntimeStatus {
                    state: "not-started".to_string(),
                    gateway_base_url: String::new(),
                    desktop_api_token: String::new(),
                    services: Vec::new(),
                    data_root: String::new(),
                    log_root: String::new(),
                    browser_access: BrowserAccessStatus::not_started(),
                },
                children: Vec::new(),
                bridge_child: None,
                tailnet_bridge_child: None,
                tailscale_status: tailscale_not_started_status(),
                tailscale_operation: None,
                context: None,
            }),
            tailscale_operations: Mutex::new(()),
        }
    }

    fn status(&self) -> RuntimeStatus {
        self.inner
            .lock()
            .expect("runtime lock poisoned")
            .status
            .clone()
    }

    fn start(&self, app: &tauri::AppHandle) -> Result<RuntimeStatus, String> {
        let _tailscale_operation = self
            .tailscale_operations
            .lock()
            .map_err(|_| "tailscale operation lock poisoned")?;
        let mut inner = self.inner.lock().map_err(|_| "runtime lock poisoned")?;
        if inner.status.state == "ready" || inner.status.state == "starting" {
            return Ok(inner.status.clone());
        }

        inner.status.state = "starting".to_string();
        drop(inner);

        let result = start_runtime(app);
        let mut inner = self.inner.lock().map_err(|_| "runtime lock poisoned")?;
        match result {
            Ok(startup) => {
                inner.status = startup.status;
                inner.children = startup.children;
                inner.bridge_child = startup.bridge_child;
                inner.tailnet_bridge_child = startup.tailnet_bridge_child;
                inner.tailscale_status = startup.tailscale_status;
                inner.context = Some(startup.context);
                Ok(inner.status.clone())
            }
            Err(error) => {
                inner.status.state = "failed".to_string();
                Err(error)
            }
        }
    }

    fn stop(&self) {
        let Ok(_tailscale_operation) = self.tailscale_operations.lock() else {
            return;
        };
        if let Ok(mut inner) = self.inner.lock() {
            if let Some(context) = inner.context.clone() {
                let operation_id = Uuid::new_v4().to_string();
                let mut backend = DesktopTailscaleBackend {
                    context: &context,
                    bridge_child: &mut inner.tailnet_bridge_child,
                    mutation_evidence: None,
                };
                shutdown_tailscale_runtime(&mut backend, &operation_id);
            } else if let Some(child) = &mut inner.tailnet_bridge_child {
                let _ = child.kill();
                let _ = child.wait();
                inner.tailnet_bridge_child = None;
            }
            if let Some(child) = &mut inner.bridge_child {
                let _ = child.kill();
                let _ = child.wait();
            }
            inner.bridge_child = None;
            for child in &mut inner.children {
                let _ = child.kill();
                let _ = child.wait();
            }
            inner.children.clear();
            inner.context = None;
            if inner.status.state != "not-started" {
                inner.status.state = "stopped".to_string();
                inner.status.browser_access.state = "stopped".to_string();
                inner.status.browser_access.port = None;
                inner.status.browser_access.urls.clear();
            }
        }
    }

    fn tailscale_access(&self, action: LifecycleAction) -> TailscaleAccessStatus {
        let Ok(_tailscale_operation) = self.tailscale_operations.lock() else {
            return tailscale_not_started_status();
        };
        let mut inner = match self.inner.lock() {
            Ok(inner) => inner,
            Err(_) => return tailscale_not_started_status(),
        };
        let Some(context) = inner.context.clone() else {
            return inner.tailscale_status.clone();
        };
        let operation_id = Uuid::new_v4().to_string();
        inner.tailscale_operation = Some(operation_id.clone());
        let status = {
            let mut backend = DesktopTailscaleBackend {
                context: &context,
                bridge_child: &mut inner.tailnet_bridge_child,
                mutation_evidence: None,
            };
            perform_tailscale_operation(&mut backend, action, &operation_id)
        };
        inner.tailscale_status = status.clone();
        inner.tailscale_operation = None;
        status
    }

    fn browser_access_status(&self, app: &tauri::AppHandle) -> BrowserAccessStatus {
        if let Ok(inner) = self.inner.lock() {
            if inner.status.state == "ready" || inner.status.state == "starting" {
                return inner.status.browser_access.clone();
            }
        }

        match RuntimePaths::resolve(app) {
            Ok(paths) => {
                let config_path = browser_access_settings_path(&paths.config_root);
                let settings = load_browser_access_settings(&config_path)
                    .unwrap_or_else(|_| default_browser_access_settings());
                BrowserAccessStatus::from_settings(
                    &settings,
                    &config_path,
                    "stopped",
                    None,
                    None,
                    None,
                )
            }
            Err(error) => BrowserAccessStatus::error("unknown", error),
        }
    }

    fn update_browser_access(
        &self,
        app: &tauri::AppHandle,
        update: BrowserAccessSettingsUpdate,
    ) -> Result<BrowserAccessStatus, String> {
        let paths = RuntimePaths::resolve(app)?;
        fs::create_dir_all(&paths.config_root).map_err(display_error)?;
        let config_path = browser_access_settings_path(&paths.config_root);
        let mut settings = load_browser_access_settings(&config_path)
            .unwrap_or_else(|_| default_browser_access_settings());
        settings.enabled = update.enabled;
        settings.network_scope = update.network_scope;
        settings.port = normalize_browser_port(update.port);
        settings.bind_address = bind_address_for_scope(settings.network_scope);
        if settings.transport_secret.trim().is_empty() {
            settings.transport_secret = Uuid::new_v4().to_string();
        }

        let mut inner = self.inner.lock().map_err(|_| "runtime lock poisoned")?;
        if settings.enabled {
            if let Some(context) = &inner.context {
                if !gateway_account_initialized(context).unwrap_or(false) {
                    let status = BrowserAccessStatus::from_settings(
                        &settings,
                        &config_path,
                        "failed",
                        None,
                        Some(
                            "Create your local BrainDrive account before enabling Browser Access."
                                .to_string(),
                        ),
                        Some(false),
                    );
                    inner.status.browser_access = status.clone();
                    return Ok(status);
                }
            }
        }

        save_browser_access_settings(&config_path, &settings)?;

        if let Some(child) = &mut inner.bridge_child {
            let _ = child.kill();
            let _ = child.wait();
        }
        inner.bridge_child = None;

        let (status, bridge_child) = if let Some(context) = &inner.context {
            reconcile_browser_access_process(context, settings, None)?
        } else {
            (
                BrowserAccessStatus::from_settings(
                    &settings,
                    &config_path,
                    "stopped",
                    None,
                    None,
                    None,
                ),
                None,
            )
        };
        inner.bridge_child = bridge_child;
        inner.status.browser_access = status.clone();
        rebuild_browser_access_service_status(&mut inner.status.services, &status);
        Ok(status)
    }

    fn restart_browser_access(
        &self,
        app: &tauri::AppHandle,
    ) -> Result<BrowserAccessStatus, String> {
        let paths = RuntimePaths::resolve(app)?;
        let config_path = browser_access_settings_path(&paths.config_root);
        let settings = load_browser_access_settings(&config_path)
            .unwrap_or_else(|_| default_browser_access_settings());

        let mut inner = self.inner.lock().map_err(|_| "runtime lock poisoned")?;
        if let Some(child) = &mut inner.bridge_child {
            let _ = child.kill();
            let _ = child.wait();
        }
        inner.bridge_child = None;

        let (status, bridge_child) = if let Some(context) = &inner.context {
            reconcile_browser_access_process(context, settings, None)?
        } else {
            (
                BrowserAccessStatus::from_settings(
                    &settings,
                    &config_path,
                    "stopped",
                    None,
                    None,
                    None,
                ),
                None,
            )
        };
        inner.bridge_child = bridge_child;
        inner.status.browser_access = status.clone();
        rebuild_browser_access_service_status(&mut inner.status.services, &status);
        Ok(status)
    }
}

impl BrowserAccessStatus {
    fn not_started() -> Self {
        Self {
            enabled: false,
            state: "not-started".to_string(),
            network_scope: BrowserAccessNetworkScope::ThisComputer,
            bind_address: "127.0.0.1".to_string(),
            requested_port: BROWSER_ACCESS_DEFAULT_PORT,
            port: None,
            urls: Vec::new(),
            config_path: String::new(),
            firewall_hint: "Browser Access is disabled.".to_string(),
            last_error: None,
            account_initialized: None,
        }
    }

    fn error(config_path: &str, error: String) -> Self {
        Self {
            enabled: false,
            state: "failed".to_string(),
            network_scope: BrowserAccessNetworkScope::ThisComputer,
            bind_address: "127.0.0.1".to_string(),
            requested_port: BROWSER_ACCESS_DEFAULT_PORT,
            port: None,
            urls: Vec::new(),
            config_path: config_path.to_string(),
            firewall_hint: "Browser Access status is unavailable.".to_string(),
            last_error: Some(error),
            account_initialized: None,
        }
    }

    fn from_settings(
        settings: &BrowserAccessSettings,
        config_path: &Path,
        state: &str,
        bound_port: Option<u16>,
        last_error: Option<String>,
        account_initialized: Option<bool>,
    ) -> Self {
        let urls = bound_port
            .map(|port| browser_access_urls(settings, port))
            .unwrap_or_default();
        Self {
            enabled: settings.enabled,
            state: state.to_string(),
            network_scope: settings.network_scope,
            bind_address: settings.bind_address.clone(),
            requested_port: settings.port,
            port: bound_port,
            urls,
            config_path: config_path.display().to_string(),
            firewall_hint: firewall_hint_for(settings, bound_port),
            last_error,
            account_initialized,
        }
    }
}

impl LaunchState {
    fn new() -> Self {
        Self {
            inner: Mutex::new(LaunchInner {
                frontend_ready: false,
                runtime_finished: false,
                main_shown: false,
            }),
        }
    }
}

impl Drop for RuntimeManager {
    fn drop(&mut self) {
        self.stop();
    }
}

#[tauri::command]
fn get_runtime_status(runtime: State<Arc<RuntimeManager>>) -> RuntimeStatus {
    let deadline = Instant::now() + Duration::from_secs(35);
    loop {
        let status = runtime.status();
        if status.state != "starting" || Instant::now() >= deadline {
            return status;
        }
        thread::sleep(Duration::from_millis(100));
    }
}

#[tauri::command]
fn get_browser_access_status(
    app: tauri::AppHandle,
    runtime: State<Arc<RuntimeManager>>,
) -> BrowserAccessStatus {
    runtime.browser_access_status(&app)
}

#[tauri::command]
fn get_tailscale_access_status(runtime: State<Arc<RuntimeManager>>) -> TailscaleAccessStatus {
    runtime.tailscale_access(LifecycleAction::Status)
}

#[tauri::command]
fn enable_tailscale_access(runtime: State<Arc<RuntimeManager>>) -> TailscaleAccessStatus {
    runtime.tailscale_access(LifecycleAction::Enable)
}

#[tauri::command]
fn retry_tailscale_access(runtime: State<Arc<RuntimeManager>>) -> TailscaleAccessStatus {
    runtime.tailscale_access(LifecycleAction::Retry)
}

#[tauri::command]
fn disable_tailscale_access(runtime: State<Arc<RuntimeManager>>) -> TailscaleAccessStatus {
    runtime.tailscale_access(LifecycleAction::Disable)
}

#[tauri::command]
fn update_browser_access_settings(
    app: tauri::AppHandle,
    runtime: State<Arc<RuntimeManager>>,
    settings: BrowserAccessSettingsUpdate,
) -> Result<BrowserAccessStatus, String> {
    runtime.update_browser_access(&app, settings)
}

#[tauri::command]
fn restart_browser_access(
    app: tauri::AppHandle,
    runtime: State<Arc<RuntimeManager>>,
) -> Result<BrowserAccessStatus, String> {
    runtime.restart_browser_access(&app)
}

#[tauri::command]
fn apply_browser_access_firewall_rule(
    app: tauri::AppHandle,
    runtime: State<Arc<RuntimeManager>>,
    enabled: bool,
) -> FirewallRuleResult {
    let status = runtime.browser_access_status(&app);
    apply_firewall_rule_for_status(&status, enabled)
}

#[tauri::command]
fn restart_runtime(
    app: tauri::AppHandle,
    runtime: State<Arc<RuntimeManager>>,
) -> Result<RuntimeStatus, String> {
    runtime.stop();
    runtime.start(&app)
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    validate_external_url(&url)?;

    let mut command = if cfg!(windows) {
        let mut command = Command::new("rundll32");
        command.arg("url.dll,FileProtocolHandler").arg(&url);
        #[cfg(windows)]
        command.creation_flags(CREATE_NO_WINDOW);
        command
    } else if cfg!(target_os = "macos") {
        let mut command = Command::new("open");
        command.arg(&url);
        command
    } else {
        let mut command = Command::new("xdg-open");
        command.arg(&url);
        command
    };

    command.spawn().map_err(display_error)?;
    Ok(())
}

#[tauri::command]
fn frontend_ready(app: tauri::AppHandle, launch: State<Arc<LaunchState>>) -> Result<(), String> {
    {
        let mut state = launch
            .inner
            .lock()
            .map_err(|_| "launch state lock poisoned")?;
        state.frontend_ready = true;
    }
    maybe_show_main_window(&app, &launch)
}

fn main() {
    let runtime = Arc::new(RuntimeManager::new());
    let launch_state = Arc::new(LaunchState::new());
    let setup_runtime = runtime.clone();
    let setup_launch_state = launch_state.clone();
    let window_runtime = runtime.clone();
    tauri::Builder::default()
        .manage(runtime.clone())
        .manage(launch_state.clone())
        .invoke_handler(tauri::generate_handler![
            get_runtime_status,
            get_tailscale_access_status,
            enable_tailscale_access,
            retry_tailscale_access,
            disable_tailscale_access,
            get_browser_access_status,
            update_browser_access_settings,
            restart_browser_access,
            apply_browser_access_firewall_rule,
            restart_runtime,
            open_external_url,
            frontend_ready
        ])
        .setup(move |app| {
            let app_handle = app.handle().clone();
            let runtime = setup_runtime.clone();
            let launch_state = setup_launch_state.clone();
            thread::spawn(move || {
                if let Err(error) = runtime.start(&app_handle) {
                    append_supervisor_log_from_app(
                        &app_handle,
                        &format!("runtime failed: {error}"),
                    );
                }

                if let Ok(mut state) = launch_state.inner.lock() {
                    state.runtime_finished = true;
                }

                let _ = maybe_show_main_window(&app_handle, &launch_state);
            });
            Ok(())
        })
        .on_window_event(move |window, event| {
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                window_runtime.stop();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running BrainDrive desktop");
}

fn maybe_show_main_window(app: &tauri::AppHandle, launch: &Arc<LaunchState>) -> Result<(), String> {
    let should_show = {
        let mut state = launch
            .inner
            .lock()
            .map_err(|_| "launch state lock poisoned")?;
        if state.main_shown || !state.frontend_ready || !state.runtime_finished {
            false
        } else {
            state.main_shown = true;
            true
        }
    };

    if !should_show {
        return Ok(());
    }

    if let Some(main_window) = app.get_webview_window("main") {
        main_window.show().map_err(display_error)?;
        main_window.set_focus().map_err(display_error)?;
    }

    if let Some(splash_window) = app.get_webview_window("splashscreen") {
        splash_window.close().map_err(display_error)?;
    }

    Ok(())
}

fn validate_external_url(url: &str) -> Result<(), String> {
    if url.len() > 2048 || url.trim() != url {
        return Err("invalid external URL".to_string());
    }

    let lower_url = url.to_ascii_lowercase();
    let has_allowed_scheme = lower_url.starts_with("https://") || lower_url.starts_with("http://");
    if !has_allowed_scheme || url.chars().any(char::is_control) {
        return Err("only http and https URLs can be opened externally".to_string());
    }

    Ok(())
}

fn start_runtime(app: &tauri::AppHandle) -> Result<RuntimeStartup, String> {
    let paths = RuntimePaths::resolve(app)?;
    fs::create_dir_all(&paths.memory_root).map_err(display_error)?;
    fs::create_dir_all(&paths.secrets_root).map_err(display_error)?;
    fs::create_dir_all(&paths.config_root).map_err(display_error)?;
    fs::create_dir_all(&paths.log_root).map_err(display_error)?;
    append_supervisor_log(&paths.log_root, "starting BrainDrive desktop runtime");

    let runtime_roots = RuntimeRoots::resolve(app)?;
    let node = resolve_node(app)?;
    let browser_access_config_path = browser_access_settings_path(&paths.config_root);
    let browser_access_settings = ensure_browser_access_settings(&browser_access_config_path)?;
    let gateway_port = find_free_port()?;
    let memory_port = find_free_port()?;
    let auth_port = find_free_port()?;
    let project_port = find_free_port()?;
    let desktop_api_token = Uuid::new_v4().to_string();
    let gateway_base_url = format!("http://127.0.0.1:{gateway_port}");
    let mcp_servers_file = paths.config_root.join("mcp.servers.native.generated.json");

    write_mcp_servers_file(&mcp_servers_file, memory_port, auth_port, project_port)?;
    append_supervisor_log(
        &paths.log_root,
        &format!(
            "allocated ports: gateway={gateway_port}, memory={memory_port}, auth={auth_port}, project={project_port}"
        ),
    );

    append_supervisor_log(&paths.log_root, "spawning mcp-memory");
    let mut children = Vec::new();
    children.push(spawn_mcp(
        &node,
        &runtime_roots.mcp_root,
        &paths,
        "memory",
        memory_port,
    )?);
    append_supervisor_log(&paths.log_root, "spawning mcp-auth");
    children.push(spawn_mcp(
        &node,
        &runtime_roots.mcp_root,
        &paths,
        "auth",
        auth_port,
    )?);
    append_supervisor_log(&paths.log_root, "spawning mcp-project");
    children.push(spawn_mcp(
        &node,
        &runtime_roots.mcp_root,
        &paths,
        "project",
        project_port,
    )?);

    wait_for_health(memory_port, "/healthz", "mcp-memory", &paths.log_root)?;
    wait_for_health(auth_port, "/healthz", "mcp-auth", &paths.log_root)?;
    wait_for_health(project_port, "/healthz", "mcp-project", &paths.log_root)?;

    append_supervisor_log(&paths.log_root, "spawning gateway");
    children.push(spawn_gateway(GatewayLaunch {
        node: &node,
        typescript_root: &runtime_roots.typescript_root,
        paths: &paths,
        port: gateway_port,
        gateway_base_url: &gateway_base_url,
        desktop_api_token: &desktop_api_token,
        internal_transport_token: &browser_access_settings.transport_secret,
        mcp_servers_file: &mcp_servers_file,
    })?);
    wait_for_health(gateway_port, "/health", "gateway", &paths.log_root)?;

    let context = RuntimeContext {
        node,
        typescript_root: runtime_roots.typescript_root.clone(),
        web_root: runtime_roots.web_root.clone(),
        gateway_base_url: gateway_base_url.clone(),
        desktop_api_token: desktop_api_token.clone(),
        internal_transport_token: browser_access_settings.transport_secret.clone(),
        config_root: paths.config_root.clone(),
        log_root: paths.log_root.clone(),
    };

    let (browser_access_status, bridge_child) =
        reconcile_browser_access_process(&context, browser_access_settings, None)?;
    let mut tailnet_bridge_child = None;
    let tailscale_status = {
        let mut backend = DesktopTailscaleBackend {
            context: &context,
            bridge_child: &mut tailnet_bridge_child,
            mutation_evidence: None,
        };
        perform_tailscale_operation(
            &mut backend,
            LifecycleAction::Startup,
            &Uuid::new_v4().to_string(),
        )
    };

    let status = RuntimeStatus {
        state: "ready".to_string(),
        gateway_base_url,
        desktop_api_token,
        services: build_service_statuses(
            service_status("mcp-memory", memory_port),
            service_status("mcp-auth", auth_port),
            service_status("mcp-project", project_port),
            service_status("gateway", gateway_port),
            browser_access_status.clone(),
        ),
        data_root: paths.data_root.display().to_string(),
        log_root: paths.log_root.display().to_string(),
        browser_access: browser_access_status,
    };
    append_supervisor_log(&paths.log_root, "BrainDrive desktop runtime ready");

    Ok(RuntimeStartup {
        status,
        children,
        bridge_child,
        tailnet_bridge_child,
        tailscale_status,
        context,
    })
}

fn default_browser_access_settings() -> BrowserAccessSettings {
    BrowserAccessSettings {
        enabled: false,
        network_scope: BrowserAccessNetworkScope::ThisComputer,
        port: BROWSER_ACCESS_DEFAULT_PORT,
        bind_address: "127.0.0.1".to_string(),
        transport_secret: String::new(),
    }
}

fn browser_access_settings_path(config_root: &Path) -> PathBuf {
    config_root.join("browser-access.json")
}

fn load_browser_access_settings(path: &Path) -> Result<BrowserAccessSettings, String> {
    let raw = fs::read_to_string(path).map_err(display_error)?;
    let mut settings: BrowserAccessSettings = serde_json::from_str(&raw).map_err(display_error)?;
    settings.port = normalize_browser_port(settings.port);
    settings.bind_address = bind_address_for_scope(settings.network_scope);
    Ok(settings)
}

fn ensure_browser_access_settings(path: &Path) -> Result<BrowserAccessSettings, String> {
    let mut settings =
        load_browser_access_settings(path).unwrap_or_else(|_| default_browser_access_settings());
    settings.port = normalize_browser_port(settings.port);
    settings.bind_address = bind_address_for_scope(settings.network_scope);
    if settings.transport_secret.trim().is_empty() {
        settings.transport_secret = Uuid::new_v4().to_string();
    }
    save_browser_access_settings(path, &settings)?;
    Ok(settings)
}

fn save_browser_access_settings(
    path: &Path,
    settings: &BrowserAccessSettings,
) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(display_error)?;
    }
    let mut file = File::create(path).map_err(display_error)?;
    file.write_all(
        serde_json::to_string_pretty(settings)
            .map_err(display_error)?
            .as_bytes(),
    )
    .map_err(display_error)?;
    file.write_all(b"\n").map_err(display_error)?;
    Ok(())
}

fn normalize_browser_port(port: u16) -> u16 {
    if (BROWSER_ACCESS_DEFAULT_PORT..=BROWSER_ACCESS_FALLBACK_END_PORT).contains(&port) {
        port
    } else {
        BROWSER_ACCESS_DEFAULT_PORT
    }
}

fn bind_address_for_scope(scope: BrowserAccessNetworkScope) -> String {
    match scope {
        BrowserAccessNetworkScope::ThisComputer => "127.0.0.1".to_string(),
        BrowserAccessNetworkScope::PrivateNetwork => "0.0.0.0".to_string(),
    }
}

fn reconcile_browser_access_process(
    context: &RuntimeContext,
    mut settings: BrowserAccessSettings,
    known_account_initialized: Option<bool>,
) -> Result<(BrowserAccessStatus, Option<Child>), String> {
    let config_path = browser_access_settings_path(&context.config_root);
    settings.port = normalize_browser_port(settings.port);
    settings.bind_address = bind_address_for_scope(settings.network_scope);

    if !settings.enabled {
        return Ok((
            BrowserAccessStatus::from_settings(
                &settings,
                &config_path,
                "stopped",
                None,
                None,
                known_account_initialized,
            ),
            None,
        ));
    }

    let account_initialized = known_account_initialized
        .or_else(|| gateway_account_initialized(context).ok())
        .unwrap_or(false);
    if !account_initialized {
        return Ok((
            BrowserAccessStatus::from_settings(
                &settings,
                &config_path,
                "failed",
                None,
                Some(
                    "Create your local BrainDrive account before enabling Browser Access."
                        .to_string(),
                ),
                Some(false),
            ),
            None,
        ));
    }

    let (port, port_error) = select_browser_access_port(&settings.bind_address, settings.port);
    let Some(port) = port else {
        return Ok((
            BrowserAccessStatus::from_settings(
                &settings,
                &config_path,
                "failed",
                None,
                Some(
                    port_error
                        .unwrap_or_else(|| "No Browser Access port is available.".to_string()),
                ),
                Some(true),
            ),
            None,
        ));
    };

    match spawn_bridge(context, &settings, port) {
        Ok(child) => {
            wait_for_health(port, "/healthz", "browser-access", &context.log_root)?;
            Ok((
                BrowserAccessStatus::from_settings(
                    &settings,
                    &config_path,
                    "running",
                    Some(port),
                    None,
                    Some(true),
                ),
                Some(child),
            ))
        }
        Err(error) => Ok((
            BrowserAccessStatus::from_settings(
                &settings,
                &config_path,
                "failed",
                None,
                Some(error),
                Some(true),
            ),
            None,
        )),
    }
}

fn select_browser_access_port(
    bind_address: &str,
    requested_port: u16,
) -> (Option<u16>, Option<String>) {
    if port_is_available(bind_address, requested_port) {
        return (Some(requested_port), None);
    }

    for port in BROWSER_ACCESS_DEFAULT_PORT..=BROWSER_ACCESS_FALLBACK_END_PORT {
        if port != requested_port && port_is_available(bind_address, port) {
            return (
                Some(port),
                Some(format!("Port {requested_port} is already in use.")),
            );
        }
    }

    (
        None,
        Some(format!(
            "Ports {BROWSER_ACCESS_DEFAULT_PORT}-{BROWSER_ACCESS_FALLBACK_END_PORT} are already in use."
        )),
    )
}

fn port_is_available(bind_address: &str, port: u16) -> bool {
    TcpListener::bind((bind_address, port)).is_ok()
}

fn spawn_bridge(
    context: &RuntimeContext,
    settings: &BrowserAccessSettings,
    port: u16,
) -> Result<Child, String> {
    let script = PathBuf::from("dist").join("desktop").join("bridge.js");
    let script_path = context.typescript_root.join(&script);
    if !script_path.exists() {
        return Err(format!(
            "Desktop bridge build was not found at {}",
            script_path.display()
        ));
    }
    if !context.web_root.exists() {
        return Err(format!(
            "Desktop bridge web assets were not found at {}",
            context.web_root.display()
        ));
    }

    let mut command = Command::new(&context.node);
    command
        .arg(script)
        .current_dir(&context.typescript_root)
        .env("BRAINDRIVE_BROWSER_BRIDGE_HOST", &settings.bind_address)
        .env("BRAINDRIVE_BROWSER_BRIDGE_PORT", port.to_string())
        .env("BRAINDRIVE_BROWSER_BRIDGE_WEB_ROOT", &context.web_root)
        .env(
            "BRAINDRIVE_BROWSER_BRIDGE_GATEWAY_URL",
            &context.gateway_base_url,
        )
        .env(
            "BRAINDRIVE_INTERNAL_TRANSPORT_TOKEN",
            &context.internal_transport_token,
        );
    spawn_logged(command, &context.log_root, "browser-access")
}

fn select_tailnet_bridge_port(
    preferred_port: Option<u16>,
    quarantined_port: Option<u16>,
) -> Option<u16> {
    select_tailnet_bridge_port_with(preferred_port, quarantined_port, |port| {
        port_is_available("127.0.0.1", port)
    })
}

fn select_tailnet_bridge_port_with(
    preferred_port: Option<u16>,
    quarantined_port: Option<u16>,
    mut is_available: impl FnMut(u16) -> bool,
) -> Option<u16> {
    if let Some(port) = preferred_port
        .filter(|port| (MANAGED_LOOPBACK_PORT_START..=MANAGED_LOOPBACK_PORT_END).contains(port))
        .filter(|port| Some(*port) != quarantined_port)
    {
        if is_available(port) {
            return Some(port);
        }
    }
    (MANAGED_LOOPBACK_PORT_START..=MANAGED_LOOPBACK_PORT_END).find(|port| {
        Some(*port) != preferred_port && Some(*port) != quarantined_port && is_available(*port)
    })
}

fn spawn_tailnet_bridge(context: &RuntimeContext, port: u16) -> Result<Child, String> {
    let script = PathBuf::from("dist").join("desktop").join("bridge.js");
    let script_path = context.typescript_root.join(&script);
    if !script_path.exists() {
        return Err(format!(
            "Desktop bridge build was not found at {}",
            script_path.display()
        ));
    }
    if !context.web_root.exists() {
        return Err(format!(
            "Desktop bridge web assets were not found at {}",
            context.web_root.display()
        ));
    }

    let mut command = Command::new(&context.node);
    command
        .arg(script)
        .current_dir(&context.typescript_root)
        .env("BRAINDRIVE_BROWSER_BRIDGE_HOST", "127.0.0.1")
        .env("BRAINDRIVE_BROWSER_BRIDGE_PORT", port.to_string())
        .env("BRAINDRIVE_BROWSER_BRIDGE_WEB_ROOT", &context.web_root)
        .env(
            "BRAINDRIVE_BROWSER_BRIDGE_GATEWAY_URL",
            &context.gateway_base_url,
        )
        .env(
            "BRAINDRIVE_INTERNAL_TRANSPORT_TOKEN",
            &context.internal_transport_token,
        )
        .env("BRAINDRIVE_BROWSER_BRIDGE_MODE", "tailnet")
        .env("BRAINDRIVE_BROWSER_BRIDGE_EXTERNAL_PROTO", "https");
    spawn_logged(command, &context.log_root, "tailscale-access")
}

fn child_is_running(child: &mut Option<Child>) -> bool {
    let Some(process) = child.as_mut() else {
        return false;
    };
    match process.try_wait() {
        Ok(None) | Err(_) => true,
        Ok(Some(_)) => {
            *child = None;
            false
        }
    }
}

fn stop_child_checked(child: &mut Option<Child>) -> Result<(), String> {
    let Some(mut process) = child.take() else {
        return Ok(());
    };
    match process.try_wait() {
        Ok(Some(_)) => return Ok(()),
        Ok(None) => {}
        Err(error) => {
            *child = Some(process);
            return Err(format!("could not inspect child process: {error}"));
        }
    }
    if let Err(error) = process.kill() {
        if process.try_wait().is_ok_and(|status| status.is_some()) {
            return Ok(());
        }
        *child = Some(process);
        return Err(format!("could not stop child process: {error}"));
    }
    if let Err(error) = process.wait() {
        if process.try_wait().is_ok_and(|status| status.is_some()) {
            return Ok(());
        }
        *child = Some(process);
        return Err(format!("could not wait for child process: {error}"));
    }
    Ok(())
}

fn browser_access_urls(settings: &BrowserAccessSettings, port: u16) -> Vec<String> {
    let mut urls = vec![format!("http://127.0.0.1:{port}")];
    if matches!(
        settings.network_scope,
        BrowserAccessNetworkScope::PrivateNetwork
    ) {
        if let Some(ip) = primary_private_ipv4() {
            let url = format!("http://{ip}:{port}");
            if !urls.contains(&url) {
                urls.push(url);
            }
        }
    }
    urls
}

fn primary_private_ipv4() -> Option<String> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    let address = socket.local_addr().ok()?.ip();
    let std::net::IpAddr::V4(ip) = address else {
        return None;
    };
    let octets = ip.octets();
    let is_private = octets[0] == 10
        || (octets[0] == 172 && (16..=31).contains(&octets[1]))
        || (octets[0] == 192 && octets[1] == 168);
    if is_private {
        Some(ip.to_string())
    } else {
        None
    }
}

fn firewall_hint_for(settings: &BrowserAccessSettings, port: Option<u16>) -> String {
    if !settings.enabled {
        return "Browser Access is disabled.".to_string();
    }
    if matches!(
        settings.network_scope,
        BrowserAccessNetworkScope::ThisComputer
    ) {
        return "This computer only; no firewall rule is needed.".to_string();
    }
    let selected_port = port.unwrap_or(settings.port);
    if cfg!(windows) {
        return format!(
            "Private-network access may require a Windows Firewall rule for TCP port {selected_port}."
        );
    }
    if cfg!(target_os = "macos") {
        return "macOS may ask you to allow incoming connections for BrainDrive.".to_string();
    }
    "Private-network access may require a local firewall rule.".to_string()
}

fn build_service_statuses(
    memory: ServiceStatus,
    auth: ServiceStatus,
    project: ServiceStatus,
    gateway: ServiceStatus,
    browser_access: BrowserAccessStatus,
) -> Vec<ServiceStatus> {
    let mut services = vec![memory, auth, project, gateway];
    rebuild_browser_access_service_status(&mut services, &browser_access);
    services
}

fn rebuild_browser_access_service_status(
    services: &mut Vec<ServiceStatus>,
    status: &BrowserAccessStatus,
) {
    services.retain(|service| service.id != "browser-access");
    if status.state == "running" {
        if let Some(port) = status.port {
            services.push(service_status("browser-access", port));
        }
    }
}

struct RuntimePaths {
    data_root: PathBuf,
    memory_root: PathBuf,
    secrets_root: PathBuf,
    config_root: PathBuf,
    log_root: PathBuf,
}

impl RuntimePaths {
    fn resolve(app: &tauri::AppHandle) -> Result<Self, String> {
        let data_root = if let Some(data_base) = std::env::var_os("APPDATA").map(PathBuf::from) {
            data_base.join("BrainDrive")
        } else {
            app.path().app_data_dir().map_err(display_error)?
        };
        let log_root = if let Some(local_base) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from)
        {
            local_base.join("BrainDrive").join("logs")
        } else {
            app.path().app_log_dir().map_err(display_error)?
        };

        Ok(Self {
            memory_root: data_root.join("memory"),
            secrets_root: data_root.join("secrets"),
            config_root: data_root.join("config"),
            log_root,
            data_root,
        })
    }
}

struct RuntimeRoots {
    typescript_root: PathBuf,
    mcp_root: PathBuf,
    web_root: PathBuf,
}

impl RuntimeRoots {
    fn resolve(app: &tauri::AppHandle) -> Result<Self, String> {
        if let Some(root) =
            std::env::var_os("BRAINDRIVE_DESKTOP_TYPESCRIPT_ROOT").map(PathBuf::from)
        {
            let mcp_root = std::env::var_os("BRAINDRIVE_DESKTOP_MCP_ROOT")
                .map(PathBuf::from)
                .unwrap_or_else(|| root.parent().unwrap_or(&root).join("mcp_release"));
            let web_root = std::env::var_os("BRAINDRIVE_DESKTOP_WEB_ROOT")
                .map(PathBuf::from)
                .unwrap_or_else(|| root.join("client_web").join("dist"));
            return Ok(Self {
                typescript_root: root,
                mcp_root,
                web_root,
            });
        }

        if let Ok(resource_root) = app
            .path()
            .resolve("desktop-runtime", BaseDirectory::Resource)
        {
            let typescript_root = resource_root.join("typescript");
            let mcp_root = resource_root.join("mcp_release");
            let web_root = resource_root.join("web");
            if typescript_root.exists() && mcp_root.exists() {
                return Ok(Self {
                    typescript_root,
                    mcp_root,
                    web_root,
                });
            }
        }

        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let typescript_root = manifest_dir
            .parent()
            .ok_or("Unable to resolve TypeScript root from CARGO_MANIFEST_DIR")?
            .to_path_buf();
        let mcp_root = typescript_root
            .parent()
            .ok_or("Unable to resolve builds root from TypeScript root")?
            .join("mcp_release");

        Ok(Self {
            web_root: typescript_root.join("client_web").join("dist"),
            typescript_root,
            mcp_root,
        })
    }
}

fn spawn_mcp(
    node: &Path,
    mcp_root: &Path,
    paths: &RuntimePaths,
    kind: &str,
    port: u16,
) -> Result<Child, String> {
    let script = PathBuf::from("dist").join("src").join("index.js");
    let script_path = mcp_root.join(&script);
    if !script_path.exists() {
        return Err(format!(
            "MCP build was not found at {}",
            script_path.display()
        ));
    }
    let mut command = Command::new(node);
    command
        .arg(script)
        .current_dir(mcp_root)
        .env("SERVER_KIND", kind)
        .env("HOST", "127.0.0.1")
        .env("PORT", port.to_string())
        .env("MEMORY_ROOT", &paths.memory_root);
    spawn_logged(command, &paths.log_root, &format!("mcp-{kind}"))
}

struct GatewayLaunch<'a> {
    node: &'a Path,
    typescript_root: &'a Path,
    paths: &'a RuntimePaths,
    port: u16,
    gateway_base_url: &'a str,
    desktop_api_token: &'a str,
    internal_transport_token: &'a str,
    mcp_servers_file: &'a Path,
}

fn spawn_gateway(launch: GatewayLaunch<'_>) -> Result<Child, String> {
    let script = PathBuf::from("dist").join("gateway").join("server.js");
    let script_path = launch.typescript_root.join(&script);
    if !script_path.exists() {
        return Err(format!(
            "Gateway build was not found at {}",
            script_path.display()
        ));
    }
    let mut command = Command::new(launch.node);
    command
        .arg(script)
        .current_dir(launch.typescript_root)
        .env("NODE_ENV", "production")
        .env("BRAINDRIVE_INSTALL_MODE", "local")
        .env("BRAINDRIVE_BIND_ADDRESS", "127.0.0.1")
        .env("BRAINDRIVE_PORT", launch.port.to_string())
        .env("BRAINDRIVE_TRUST_PROXY", "false")
        .env("BRAINDRIVE_CLIENT_GATEWAY_URL", launch.gateway_base_url)
        .env("BRAINDRIVE_DESKTOP_API_TOKEN", launch.desktop_api_token)
        .env(
            "BRAINDRIVE_INTERNAL_TRANSPORT_TOKEN",
            launch.internal_transport_token,
        )
        .env("PAA_MEMORY_ROOT", &launch.paths.memory_root)
        .env("PAA_SECRETS_HOME", &launch.paths.secrets_root)
        .env("PAA_SECRETS_MASTER_KEY_ID", "owner-master-v1")
        .env("PAA_AUTH_ALLOW_FIRST_SIGNUP_ANY_IP", "false")
        .env("MCP_SERVERS_FILE", launch.mcp_servers_file)
        .env("OLLAMA_BASE_URL", "http://127.0.0.1:11434/v1");
    spawn_logged(command, &launch.paths.log_root, "gateway")
}

fn spawn_logged(mut command: Command, log_root: &Path, name: &str) -> Result<Child, String> {
    let stdout_path = log_root.join(format!("{name}.stdout.log"));
    let stderr_path = log_root.join(format!("{name}.stderr.log"));
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    configure_hidden_child_process(&mut command);
    let mut child = command.spawn().map_err(display_error)?;

    if let Some(stdout) = child.stdout.take() {
        pipe_to_log(stdout, stdout_path);
    }
    if let Some(stderr) = child.stderr.take() {
        pipe_to_log(stderr, stderr_path);
    }

    Ok(child)
}

#[cfg(windows)]
fn configure_hidden_child_process(command: &mut Command) {
    use std::os::windows::process::CommandExt;

    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn configure_hidden_child_process(_command: &mut Command) {}

fn pipe_to_log<R>(mut reader: R, path: PathBuf)
where
    R: Read + Send + 'static,
{
    thread::spawn(move || {
        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
            let mut buffer = [0; 8192];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(count) => {
                        let _ = file.write_all(&buffer[..count]);
                    }
                    Err(_) => break,
                }
            }
        }
    });
}

fn write_mcp_servers_file(
    path: &Path,
    memory_port: u16,
    auth_port: u16,
    project_port: u16,
) -> Result<(), String> {
    let document = json!({
        "servers": [
            mcp_server("memory", memory_port, ["memory_read", "memory_list", "memory_search", "memory_history", "memory_export"]),
            mcp_server("auth", auth_port, ["auth_whoami", "auth_check", "auth_export"]),
            mcp_server("project", project_port, ["project_list"])
        ]
    });
    let mut file = File::create(path).map_err(display_error)?;
    file.write_all(
        serde_json::to_string_pretty(&document)
            .map_err(display_error)?
            .as_bytes(),
    )
    .map_err(display_error)?;
    file.write_all(b"\n").map_err(display_error)?;
    Ok(())
}

fn mcp_server<const N: usize>(
    id: &str,
    port: u16,
    read_only_tools: [&str; N],
) -> serde_json::Value {
    json!({
        "id": id,
        "transport": "streamable-http",
        "url": format!("http://127.0.0.1:{port}/mcp"),
        "tool_name_prefix": "",
        "enabled": true,
        "timeout_ms": 10000,
        "read_only_tools": read_only_tools.to_vec(),
        "source_kind": "system_shipped",
        "trust_level": "first_party",
        "isolation": "process",
        "required": true
    })
}

fn service_status(id: &str, port: u16) -> ServiceStatus {
    ServiceStatus {
        id: id.to_string(),
        state: "ready".to_string(),
        port,
    }
}

fn find_free_port() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(display_error)?;
    let port = listener.local_addr().map_err(display_error)?.port();
    drop(listener);
    Ok(port)
}

fn wait_for_health(port: u16, path: &str, label: &str, log_root: &Path) -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_secs(30);
    while Instant::now() < deadline {
        if http_health_ok(port, path) {
            append_supervisor_log(
                log_root,
                &format!("{label} healthy on 127.0.0.1:{port}{path}"),
            );
            return Ok(());
        }
        thread::sleep(Duration::from_millis(300));
    }
    append_supervisor_log(
        log_root,
        &format!("{label} failed health check on 127.0.0.1:{port}{path}"),
    );
    Err(format!(
        "{label} did not become healthy on 127.0.0.1:{port}{path}"
    ))
}

fn http_health_ok(port: u16, path: &str) -> bool {
    let Ok(mut stream) = TcpStream::connect(("127.0.0.1", port)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
    let request =
        format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let _ = stream.shutdown(Shutdown::Write);

    let mut response = Vec::new();
    let mut buffer = [0; 512];
    loop {
        match stream.read(&mut buffer) {
            Ok(0) => break,
            Ok(count) => {
                response.extend_from_slice(&buffer[..count]);
                if response.windows(4).any(|window| window == b"\r\n\r\n") {
                    break;
                }
            }
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) =>
            {
                break;
            }
            Err(_) => return false,
        }
    }

    response.starts_with(b"HTTP/1.1 200") || response.starts_with(b"HTTP/1.0 200")
}

fn gateway_account_initialized(context: &RuntimeContext) -> Result<bool, String> {
    let port = gateway_port_from_base_url(&context.gateway_base_url)?;
    let response = http_get_local(
        port,
        "/auth/bootstrap-status",
        Some((
            "x-braindrive-desktop-token",
            context.desktop_api_token.as_str(),
        )),
    )?;
    if !response.status_line.starts_with("HTTP/1.1 200")
        && !response.status_line.starts_with("HTTP/1.0 200")
    {
        return Err(format!(
            "Gateway bootstrap status returned {}",
            response.status_line
        ));
    }

    let payload: serde_json::Value =
        serde_json::from_slice(&response.body).map_err(display_error)?;
    Ok(payload
        .get("account_initialized")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false))
}

fn gateway_port_from_base_url(base_url: &str) -> Result<u16, String> {
    let remainder = base_url
        .strip_prefix("http://127.0.0.1:")
        .or_else(|| base_url.strip_prefix("http://localhost:"))
        .ok_or_else(|| format!("Unsupported local gateway URL: {base_url}"))?;
    let port = remainder.split('/').next().unwrap_or(remainder);
    port.parse::<u16>().map_err(display_error)
}

struct LocalHttpResponse {
    status_line: String,
    body: Vec<u8>,
}

fn http_get_local(
    port: u16,
    path: &str,
    extra_header: Option<(&str, &str)>,
) -> Result<LocalHttpResponse, String> {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).map_err(display_error)?;
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .map_err(display_error)?;
    stream
        .set_write_timeout(Some(Duration::from_secs(5)))
        .map_err(display_error)?;

    let mut request =
        format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n");
    if let Some((name, value)) = extra_header {
        request.push_str(name);
        request.push_str(": ");
        request.push_str(value);
        request.push_str("\r\n");
    }
    request.push_str("\r\n");

    stream
        .write_all(request.as_bytes())
        .map_err(display_error)?;
    let _ = stream.shutdown(Shutdown::Write);

    let mut response = Vec::new();
    stream.read_to_end(&mut response).map_err(display_error)?;
    let header_end = response
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .ok_or_else(|| "Local gateway returned an invalid HTTP response".to_string())?;
    let headers = String::from_utf8_lossy(&response[..header_end]);
    let status_line = headers
        .lines()
        .next()
        .unwrap_or("HTTP/1.1 000 Unknown")
        .to_string();

    Ok(LocalHttpResponse {
        status_line,
        body: response[(header_end + 4)..].to_vec(),
    })
}

fn apply_firewall_rule_for_status(
    status: &BrowserAccessStatus,
    enabled: bool,
) -> FirewallRuleResult {
    let command = firewall_rule_command(status, enabled);
    if matches!(
        status.network_scope,
        BrowserAccessNetworkScope::ThisComputer
    ) {
        return FirewallRuleResult {
            ok: true,
            message: "This-computer scope does not need an inbound firewall rule.".to_string(),
            command,
        };
    }

    let Some(port) = status.port.or(Some(status.requested_port)) else {
        return FirewallRuleResult {
            ok: false,
            message: "Browser Access does not have a selected port yet.".to_string(),
            command,
        };
    };

    if cfg!(windows) {
        if enabled {
            let _ = run_netsh(&[
                "advfirewall",
                "firewall",
                "delete",
                "rule",
                &format!("name={FIREWALL_RULE_NAME}"),
            ]);
            return run_netsh_with_result(
                &[
                    "advfirewall",
                    "firewall",
                    "add",
                    "rule",
                    &format!("name={FIREWALL_RULE_NAME}"),
                    "dir=in",
                    "action=allow",
                    "protocol=TCP",
                    &format!("localport={port}"),
                    "profile=private",
                ],
                command,
                format!("Windows Firewall private-network rule added for TCP port {port}."),
            );
        }

        return run_netsh_with_result(
            &[
                "advfirewall",
                "firewall",
                "delete",
                "rule",
                &format!("name={FIREWALL_RULE_NAME}"),
            ],
            command,
            "Windows Firewall rule removed.".to_string(),
        );
    }

    if cfg!(target_os = "macos") {
        return match open_macos_firewall_settings() {
            Ok(_) => FirewallRuleResult {
                ok: true,
                message: "Opened macOS System Settings. In Network > Firewall, allow incoming connections for BrainDrive if prompted.".to_string(),
                command,
            },
            Err(error) => FirewallRuleResult {
                ok: false,
                message: format!(
                    "Open macOS System Settings > Network > Firewall and allow incoming connections for BrainDrive. Unable to open System Settings automatically: {error}"
                ),
                command,
            },
        };
    }

    FirewallRuleResult {
        ok: false,
        message: format!(
            "Allow inbound TCP {port} on private networks using your operating system firewall."
        ),
        command,
    }
}

fn firewall_rule_command(status: &BrowserAccessStatus, enabled: bool) -> String {
    let port = status.port.unwrap_or(status.requested_port);
    if cfg!(windows) {
        if enabled {
            format!(
                "netsh advfirewall firewall add rule name=\"{FIREWALL_RULE_NAME}\" dir=in action=allow protocol=TCP localport={port} profile=private"
            )
        } else {
            format!("netsh advfirewall firewall delete rule name=\"{FIREWALL_RULE_NAME}\"")
        }
    } else if cfg!(target_os = "macos") {
        "open -b com.apple.systempreferences".to_string()
    } else if enabled {
        format!("Allow inbound TCP {port} from your private network.")
    } else {
        format!("Remove the inbound TCP {port} private-network firewall rule.")
    }
}

#[cfg(target_os = "macos")]
fn open_macos_firewall_settings() -> Result<(), String> {
    Command::new("open")
        .args(["-b", "com.apple.systempreferences"])
        .spawn()
        .map(|_| ())
        .map_err(display_error)
}

#[cfg(not(target_os = "macos"))]
fn open_macos_firewall_settings() -> Result<(), String> {
    Err("macOS System Settings are only available on macOS.".to_string())
}

#[cfg(windows)]
fn run_netsh(args: &[&str]) -> Result<String, String> {
    let output = Command::new("netsh")
        .args(args)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(display_error)?;
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let error_text = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if output.status.success() {
        Ok(if text.is_empty() {
            "ok".to_string()
        } else {
            text
        })
    } else if error_text.is_empty() {
        Err(text)
    } else {
        Err(error_text)
    }
}

#[cfg(not(windows))]
fn run_netsh(_args: &[&str]) -> Result<String, String> {
    Err("netsh is only available on Windows.".to_string())
}

fn run_netsh_with_result(
    args: &[&str],
    command: String,
    success_message: String,
) -> FirewallRuleResult {
    match run_netsh(args) {
        Ok(_) => FirewallRuleResult {
            ok: true,
            message: success_message,
            command,
        },
        Err(error) => FirewallRuleResult {
            ok: false,
            message: format!("Unable to update Windows Firewall automatically: {error}"),
            command,
        },
    }
}

fn resolve_node(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os("BRAINDRIVE_DESKTOP_NODE").map(PathBuf::from) {
        return Ok(path);
    }

    let node_file = if cfg!(windows) { "node.exe" } else { "node" };
    if let Ok(path) = app.path().resolve(
        format!("desktop-runtime/node/{node_file}"),
        BaseDirectory::Resource,
    ) {
        if path.exists() {
            return Ok(path);
        }
    }

    Ok(PathBuf::from("node"))
}

fn append_supervisor_log(log_root: &Path, message: &str) {
    let path = log_root.join("supervisor.log");
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{message}");
    }
}

fn append_supervisor_log_from_app(app: &tauri::AppHandle, message: &str) {
    if let Ok(paths) = RuntimePaths::resolve(app) {
        append_supervisor_log(&paths.log_root, message);
    }
}

fn display_error(error: impl std::fmt::Display) -> String {
    error.to_string()
}

#[cfg(test)]
mod tailscale_bridge_tests {
    use super::*;
    use std::collections::BTreeSet;

    #[test]
    fn tailnet_port_allocator_prefers_requested_available_port() {
        let preferred = MANAGED_LOOPBACK_PORT_START + 3;
        assert_eq!(
            select_tailnet_bridge_port_with(Some(preferred), None, |_| true),
            Some(preferred)
        );
    }

    #[test]
    fn tailnet_port_allocator_falls_back_and_excludes_quarantined_port() {
        let preferred = MANAGED_LOOPBACK_PORT_START;
        let quarantined = preferred + 1;
        let available = BTreeSet::from([quarantined, quarantined + 1]);
        assert_eq!(
            select_tailnet_bridge_port_with(Some(preferred), Some(quarantined), |port| {
                available.contains(&port)
            }),
            Some(quarantined + 1)
        );
    }

    #[test]
    fn tailnet_port_allocator_never_reuses_quarantine_and_reports_exhaustion() {
        let quarantined = MANAGED_LOOPBACK_PORT_START;
        assert_eq!(
            select_tailnet_bridge_port_with(None, Some(quarantined), |port| port == quarantined),
            None
        );
        assert_eq!(select_tailnet_bridge_port_with(None, None, |_| false), None);
    }

    #[test]
    fn checked_bridge_stop_accepts_absent_and_already_exited_children() {
        let mut absent = None;
        assert_eq!(stop_child_checked(&mut absent), Ok(()));

        let mut process = Command::new(std::env::current_exe().unwrap())
            .arg("--list")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        process.wait().unwrap();
        let mut exited = Some(process);
        assert_eq!(stop_child_checked(&mut exited), Ok(()));
        assert!(exited.is_none());
    }
}
