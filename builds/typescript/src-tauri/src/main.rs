#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use serde_json::json;
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    net::{Shutdown, TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};
use tauri::{path::BaseDirectory, Manager, State};
use uuid::Uuid;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeStatus {
    state: String,
    gateway_base_url: String,
    desktop_api_token: String,
    services: Vec<ServiceStatus>,
    data_root: String,
    log_root: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ServiceStatus {
    id: String,
    state: String,
    port: u16,
}

struct RuntimeManager {
    inner: Mutex<RuntimeInner>,
}

struct RuntimeInner {
    status: RuntimeStatus,
    children: Vec<Child>,
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
                },
                children: Vec::new(),
            }),
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
        let mut inner = self.inner.lock().map_err(|_| "runtime lock poisoned")?;
        if inner.status.state == "ready" || inner.status.state == "starting" {
            return Ok(inner.status.clone());
        }

        inner.status.state = "starting".to_string();
        drop(inner);

        let result = start_runtime(app);
        let mut inner = self.inner.lock().map_err(|_| "runtime lock poisoned")?;
        match result {
            Ok((status, children)) => {
                inner.status = status;
                inner.children = children;
                Ok(inner.status.clone())
            }
            Err(error) => {
                inner.status.state = "failed".to_string();
                Err(error)
            }
        }
    }

    fn stop(&self) {
        if let Ok(mut inner) = self.inner.lock() {
            for child in &mut inner.children {
                let _ = child.kill();
                let _ = child.wait();
            }
            inner.children.clear();
            if inner.status.state != "not-started" {
                inner.status.state = "stopped".to_string();
            }
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
    runtime.status()
}

#[tauri::command]
fn restart_runtime(
    app: tauri::AppHandle,
    runtime: State<Arc<RuntimeManager>>,
) -> Result<RuntimeStatus, String> {
    runtime.stop();
    runtime.start(&app)
}

fn main() {
    let runtime = Arc::new(RuntimeManager::new());
    let setup_runtime = runtime.clone();
    let window_runtime = runtime.clone();
    tauri::Builder::default()
        .manage(runtime.clone())
        .invoke_handler(tauri::generate_handler![
            get_runtime_status,
            restart_runtime
        ])
        .setup(move |app| {
            setup_runtime
                .start(app.handle())
                .map_err(|error| std::io::Error::new(std::io::ErrorKind::Other, error))?;
            Ok(())
        })
        .on_window_event(move |_window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                window_runtime.stop();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running BrainDrive desktop");
}

fn start_runtime(app: &tauri::AppHandle) -> Result<(RuntimeStatus, Vec<Child>), String> {
    let paths = RuntimePaths::resolve(app)?;
    fs::create_dir_all(&paths.memory_root).map_err(display_error)?;
    fs::create_dir_all(&paths.secrets_root).map_err(display_error)?;
    fs::create_dir_all(&paths.config_root).map_err(display_error)?;
    fs::create_dir_all(&paths.log_root).map_err(display_error)?;
    append_supervisor_log(&paths.log_root, "starting BrainDrive desktop runtime");

    let runtime_roots = RuntimeRoots::resolve(app)?;
    let node = resolve_node(app)?;
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
    children.push(spawn_gateway(
        &node,
        &runtime_roots.typescript_root,
        &paths,
        gateway_port,
        &gateway_base_url,
        &desktop_api_token,
        &mcp_servers_file,
    )?);
    wait_for_health(gateway_port, "/health", "gateway", &paths.log_root)?;

    let status = RuntimeStatus {
        state: "ready".to_string(),
        gateway_base_url,
        desktop_api_token,
        services: vec![
            service_status("mcp-memory", memory_port),
            service_status("mcp-auth", auth_port),
            service_status("mcp-project", project_port),
            service_status("gateway", gateway_port),
        ],
        data_root: paths.data_root.display().to_string(),
        log_root: paths.log_root.display().to_string(),
    };
    append_supervisor_log(&paths.log_root, "BrainDrive desktop runtime ready");

    Ok((status, children))
}

struct RuntimePaths {
    data_root: PathBuf,
    memory_root: PathBuf,
    secrets_root: PathBuf,
    config_root: PathBuf,
    log_root: PathBuf,
}

impl RuntimePaths {
    fn resolve(_app: &tauri::AppHandle) -> Result<Self, String> {
        let data_base = std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or(
            std::env::current_dir()
                .map_err(display_error)?
                .join(".braindrive-data"),
        );
        let local_base = std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or(
                std::env::current_dir()
                    .map_err(display_error)?
                    .join(".braindrive-local"),
            );
        let data_root = data_base.join("BrainDrive");
        let local_root = local_base.join("BrainDrive");

        Ok(Self {
            memory_root: data_root.join("memory"),
            secrets_root: data_root.join("secrets"),
            config_root: data_root.join("config"),
            log_root: local_root.join("logs"),
            data_root,
        })
    }
}

struct RuntimeRoots {
    typescript_root: PathBuf,
    mcp_root: PathBuf,
}

impl RuntimeRoots {
    fn resolve(app: &tauri::AppHandle) -> Result<Self, String> {
        if let Some(root) =
            std::env::var_os("BRAINDRIVE_DESKTOP_TYPESCRIPT_ROOT").map(PathBuf::from)
        {
            let mcp_root = std::env::var_os("BRAINDRIVE_DESKTOP_MCP_ROOT")
                .map(PathBuf::from)
                .unwrap_or_else(|| root.parent().unwrap_or(&root).join("mcp_release"));
            return Ok(Self {
                typescript_root: root,
                mcp_root,
            });
        }

        if let Ok(resource_root) = app
            .path()
            .resolve("desktop-runtime", BaseDirectory::Resource)
        {
            let typescript_root = resource_root.join("typescript");
            let mcp_root = resource_root.join("mcp_release");
            if typescript_root.exists() && mcp_root.exists() {
                return Ok(Self {
                    typescript_root,
                    mcp_root,
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
    let script = mcp_root.join("dist").join("src").join("index.js");
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

fn spawn_gateway(
    node: &Path,
    typescript_root: &Path,
    paths: &RuntimePaths,
    port: u16,
    gateway_base_url: &str,
    desktop_api_token: &str,
    mcp_servers_file: &Path,
) -> Result<Child, String> {
    let script = typescript_root
        .join("dist")
        .join("gateway")
        .join("server.js");
    let mut command = Command::new(node);
    command
        .arg(script)
        .current_dir(typescript_root)
        .env("NODE_ENV", "production")
        .env("BRAINDRIVE_INSTALL_MODE", "local")
        .env("BRAINDRIVE_BIND_ADDRESS", "127.0.0.1")
        .env("BRAINDRIVE_PORT", port.to_string())
        .env("BRAINDRIVE_TRUST_PROXY", "false")
        .env("BRAINDRIVE_CLIENT_GATEWAY_URL", gateway_base_url)
        .env("BRAINDRIVE_DESKTOP_API_TOKEN", desktop_api_token)
        .env("PAA_MEMORY_ROOT", &paths.memory_root)
        .env("PAA_SECRETS_HOME", &paths.secrets_root)
        .env("PAA_SECRETS_MASTER_KEY_ID", "owner-master-v1")
        .env("PAA_AUTH_ALLOW_FIRST_SIGNUP_ANY_IP", "false")
        .env("MCP_SERVERS_FILE", mcp_servers_file)
        .env("OLLAMA_BASE_URL", "http://127.0.0.1:11434/v1");
    spawn_logged(command, &paths.log_root, "gateway")
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

fn display_error(error: impl std::fmt::Display) -> String {
    error.to_string()
}
