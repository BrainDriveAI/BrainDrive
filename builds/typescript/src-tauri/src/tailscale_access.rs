//! Pure Tailscale discovery, parsing, ownership, command, persistence, and
//! diagnostic contracts for Remote Access.
//!
//! The desktop runtime composes this module with startup reconciliation and
//! typed Tauri IPC. The only mutating command representations are a fixed
//! background HTTPS Serve mapping on port 443 to BrainDrive's allocated
//! loopback range and its exact listener-scoped `off` form. There is no generic
//! command, shell, Funnel, reset, direct-IP, or full-config API.
//!
//! The initial native contract is Windows Tailscale 1.98.8. Parsers and process
//! contracts are shared by Windows and macOS. Native macOS capture and a
//! comparison of the minimum supported version remain mandatory in Milestone 5.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    env,
    ffi::OsString,
    fs::{self, OpenOptions},
    io::{self, Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::atomic::{AtomicU64, Ordering},
    thread,
    time::{Duration, Instant},
};

#[cfg(unix)]
use std::fs::File;
#[cfg(unix)]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
#[cfg(windows)]
use std::os::windows::{ffi::OsStrExt, process::CommandExt};

pub const MINIMUM_SUPPORTED_VERSION: SemanticVersion = SemanticVersion::new(1, 98, 8);
pub const MANAGED_HTTPS_PORT: u16 = 443;
pub const MANAGED_PATH: &str = "/";
pub const MANAGED_LOOPBACK_PORT_START: u16 = 18108;
pub const MANAGED_LOOPBACK_PORT_END: u16 = 18127;
pub const STATE_SCHEMA_VERSION: u32 = 1;
pub const MAX_CAPTURE_BYTES: usize = 256 * 1024;
pub const MAX_JSON_BYTES: usize = 256 * 1024;
pub const MAX_STATE_BYTES: usize = 16 * 1024;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TailscaleAccessState {
    Off,
    NeedsSetup,
    Ready,
    Starting,
    Running,
    Conflict,
    NeedsAttention,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TailscaleReadinessState {
    Missing,
    PermissionDenied,
    UnsupportedVersion,
    DaemonUnavailable,
    SignedOut,
    Offline,
    MissingDns,
    ConsentRequired,
    Ready,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TailscaleErrorCode {
    IneligibleDeployment,
    OwnerNotInitialized,
    NotInstalled,
    PermissionDenied,
    UnsupportedVersion,
    DaemonUnavailable,
    NotSignedIn,
    Offline,
    MissingDns,
    ConsentRequired,
    Conflict,
    CommandTimeout,
    CommandFailed,
    AmbiguousOutcome,
    MalformedOutput,
    OutputTooLarge,
    Persistence,
    BridgeUnavailable,
    StaleOwnership,
    Internal,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ServeOwnership {
    Absent,
    OwnedExact,
    OccupiedUnowned,
    OwnedDrifted,
    Ambiguous,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TailnetBridgeState {
    Stopped,
    Starting,
    Running,
    Failed,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TailscaleAccessAction {
    Enable,
    Retry,
    Disable,
    CheckAgain,
    CompleteSetup,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TailscaleReadiness {
    pub state: TailscaleReadinessState,
    pub installed_version: Option<SemanticVersion>,
    pub minimum_supported_version: SemanticVersion,
    pub backend_state: Option<String>,
    pub online: Option<bool>,
    pub dns_name_available: bool,
    pub error_code: Option<TailscaleErrorCode>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TailscaleAccessStatus {
    pub state: TailscaleAccessState,
    pub desired_enabled: bool,
    pub readiness: TailscaleReadiness,
    pub ownership: ServeOwnership,
    pub bridge_state: TailnetBridgeState,
    pub access_url: Option<String>,
    pub setup_url: Option<String>,
    pub available_actions: Vec<TailscaleAccessAction>,
    pub message: String,
    pub detail: Option<String>,
    pub error_code: Option<TailscaleErrorCode>,
    pub checked_at_unix_ms: u64,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
pub struct SemanticVersion {
    pub major: u64,
    pub minor: u64,
    pub patch: u64,
}

impl SemanticVersion {
    pub const fn new(major: u64, minor: u64, patch: u64) -> Self {
        Self {
            major,
            minor,
            patch,
        }
    }

    pub fn parse(raw: &str) -> Result<Self, TailscaleErrorCode> {
        let token = raw
            .split_whitespace()
            .next()
            .ok_or(TailscaleErrorCode::MalformedOutput)?
            .trim_start_matches('v');
        let core = token.split_once('-').map_or(token, |(version, _)| version);
        let mut parts = core.split('.');
        let major = parse_version_component(parts.next())?;
        let minor = parse_version_component(parts.next())?;
        let patch = parse_version_component(parts.next())?;
        if parts.next().is_some() {
            return Err(TailscaleErrorCode::MalformedOutput);
        }
        Ok(Self::new(major, minor, patch))
    }

    pub fn is_supported(self) -> bool {
        self >= MINIMUM_SUPPORTED_VERSION
    }
}

fn parse_version_component(component: Option<&str>) -> Result<u64, TailscaleErrorCode> {
    let component = component.ok_or(TailscaleErrorCode::MalformedOutput)?;
    if component.is_empty() || !component.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(TailscaleErrorCode::MalformedOutput);
    }
    component
        .parse::<u64>()
        .map_err(|_| TailscaleErrorCode::MalformedOutput)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SupportedPlatform {
    Windows,
    MacOs,
}

pub fn current_supported_platform() -> Option<SupportedPlatform> {
    if cfg!(windows) {
        Some(SupportedPlatform::Windows)
    } else if cfg!(target_os = "macos") {
        Some(SupportedPlatform::MacOs)
    } else {
        None
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResolvedExecutable(PathBuf);

impl ResolvedExecutable {
    pub fn path(&self) -> &Path {
        &self.0
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DiscoveryError {
    Missing,
    PermissionDenied,
}

pub fn discover_tailscale(
    platform: SupportedPlatform,
) -> Result<ResolvedExecutable, DiscoveryError> {
    let candidates = executable_candidates(platform);
    select_executable(candidates)
}

fn executable_candidates(platform: SupportedPlatform) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    match platform {
        SupportedPlatform::Windows => {
            if let Some(program_files) = env::var_os("ProgramFiles") {
                candidates.push(
                    PathBuf::from(program_files)
                        .join("Tailscale")
                        .join("tailscale.exe"),
                );
            }
            if let Some(local_app_data) = env::var_os("LOCALAPPDATA") {
                candidates.push(
                    PathBuf::from(local_app_data)
                        .join("Tailscale")
                        .join("tailscale.exe"),
                );
            }
            candidates.extend(path_candidates("tailscale.exe"));
        }
        SupportedPlatform::MacOs => {
            candidates.push(PathBuf::from(
                "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
            ));
            candidates.push(PathBuf::from("/opt/homebrew/bin/tailscale"));
            candidates.push(PathBuf::from("/usr/local/bin/tailscale"));
            candidates.extend(path_candidates("tailscale"));
        }
    }
    candidates
}

fn path_candidates(binary: &str) -> Vec<PathBuf> {
    env::var_os("PATH")
        .map(|path| {
            env::split_paths(&path)
                .map(|entry| entry.join(binary))
                .collect()
        })
        .unwrap_or_default()
}

fn select_executable(
    candidates: impl IntoIterator<Item = PathBuf>,
) -> Result<ResolvedExecutable, DiscoveryError> {
    let mut permission_denied = false;
    for candidate in candidates {
        let Ok(metadata) = fs::metadata(&candidate) else {
            continue;
        };
        if !metadata.is_file() {
            continue;
        }
        if !is_executable(&metadata) {
            permission_denied = true;
            continue;
        }
        return Ok(ResolvedExecutable(candidate));
    }
    if permission_denied {
        Err(DiscoveryError::PermissionDenied)
    } else {
        Err(DiscoveryError::Missing)
    }
}

#[cfg(unix)]
fn is_executable(metadata: &fs::Metadata) -> bool {
    metadata.permissions().mode() & 0o111 != 0
}

#[cfg(not(unix))]
fn is_executable(_metadata: &fs::Metadata) -> bool {
    true
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ManagedMapping {
    loopback_port: u16,
}

impl ManagedMapping {
    pub fn new(loopback_port: u16) -> Result<Self, TailscaleErrorCode> {
        if !(MANAGED_LOOPBACK_PORT_START..=MANAGED_LOOPBACK_PORT_END).contains(&loopback_port) {
            return Err(TailscaleErrorCode::Internal);
        }
        Ok(Self { loopback_port })
    }

    pub fn target(&self) -> String {
        format!("http://127.0.0.1:{}", self.loopback_port)
    }

    pub fn loopback_port(&self) -> u16 {
        self.loopback_port
    }

    pub fn canonical(&self) -> CanonicalServeMapping {
        CanonicalServeMapping {
            https_port: MANAGED_HTTPS_PORT,
            path: MANAGED_PATH.to_string(),
            proxy_target: self.target(),
            source: ServeSource::Background,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TailscaleCommandKind {
    Version,
    Status,
    ServeStatus,
    ServeConfig,
    Enable,
    Disable,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TailscaleCommand {
    Version,
    StatusJson,
    ServeStatusJson,
    ServeGetConfigAll,
    Enable(ManagedMapping),
    Disable,
}

impl TailscaleCommand {
    pub fn kind(&self) -> TailscaleCommandKind {
        match self {
            Self::Version => TailscaleCommandKind::Version,
            Self::StatusJson => TailscaleCommandKind::Status,
            Self::ServeStatusJson => TailscaleCommandKind::ServeStatus,
            Self::ServeGetConfigAll => TailscaleCommandKind::ServeConfig,
            Self::Enable(_) => TailscaleCommandKind::Enable,
            Self::Disable => TailscaleCommandKind::Disable,
        }
    }

    pub fn args(&self) -> Vec<OsString> {
        match self {
            Self::Version => vec!["version".into()],
            Self::StatusJson => vec!["status".into(), "--json".into()],
            Self::ServeStatusJson => vec!["serve".into(), "status".into(), "--json".into()],
            Self::ServeGetConfigAll => {
                vec!["serve".into(), "get-config".into(), "--all".into()]
            }
            Self::Enable(mapping) => vec![
                "serve".into(),
                "--bg".into(),
                format!("--https={MANAGED_HTTPS_PORT}").into(),
                mapping.target().into(),
            ],
            Self::Disable => vec![
                "serve".into(),
                format!("--https={MANAGED_HTTPS_PORT}").into(),
                "off".into(),
            ],
        }
    }

    pub fn is_mutating(&self) -> bool {
        matches!(self, Self::Enable(_) | Self::Disable)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CommandSpec {
    executable: PathBuf,
    args: Vec<OsString>,
    kind: TailscaleCommandKind,
}

impl CommandSpec {
    pub fn from_allowlisted(executable: &ResolvedExecutable, command: &TailscaleCommand) -> Self {
        Self {
            executable: executable.path().to_path_buf(),
            args: command.args(),
            kind: command.kind(),
        }
    }

    pub fn executable(&self) -> &Path {
        &self.executable
    }

    pub fn args(&self) -> &[OsString] {
        &self.args
    }

    pub fn kind(&self) -> TailscaleCommandKind {
        self.kind
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RunLimits {
    pub timeout: Duration,
    pub max_capture_bytes: usize,
}

impl Default for RunLimits {
    fn default() -> Self {
        Self {
            timeout: Duration::from_secs(10),
            max_capture_bytes: MAX_CAPTURE_BYTES,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CapturedOutput {
    pub exit_code: Option<i32>,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RunnerError {
    ExecutableMissing,
    PermissionDenied,
    Timeout,
    OutputTooLarge,
    Io,
}

pub trait TailscaleRunner {
    fn run(
        &self,
        executable: &ResolvedExecutable,
        command: &TailscaleCommand,
        limits: RunLimits,
    ) -> Result<CapturedOutput, RunnerError>;
}

pub struct SystemTailscaleRunner;

impl TailscaleRunner for SystemTailscaleRunner {
    fn run(
        &self,
        executable: &ResolvedExecutable,
        command: &TailscaleCommand,
        limits: RunLimits,
    ) -> Result<CapturedOutput, RunnerError> {
        let spec = CommandSpec::from_allowlisted(executable, command);
        let mut process = Command::new(&spec.executable);
        process
            .args(&spec.args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        configure_hidden_process(&mut process);
        let mut child = process.spawn().map_err(map_spawn_error)?;
        let stdout = child.stdout.take().ok_or(RunnerError::Io)?;
        let stderr = child.stderr.take().ok_or(RunnerError::Io)?;
        let max_capture = limits.max_capture_bytes;
        let stdout_reader = thread::spawn(move || read_capped(stdout, max_capture));
        let stderr_reader = thread::spawn(move || read_capped(stderr, max_capture));

        let deadline = Instant::now() + limits.timeout;
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) if Instant::now() < deadline => {
                    thread::sleep(Duration::from_millis(10));
                }
                Ok(None) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = stdout_reader.join();
                    let _ = stderr_reader.join();
                    return Err(RunnerError::Timeout);
                }
                Err(_) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = stdout_reader.join();
                    let _ = stderr_reader.join();
                    return Err(RunnerError::Io);
                }
            }
        };

        let stdout = stdout_reader.join().map_err(|_| RunnerError::Io)??;
        let stderr = stderr_reader.join().map_err(|_| RunnerError::Io)??;
        if stdout.exceeded || stderr.exceeded {
            return Err(RunnerError::OutputTooLarge);
        }
        Ok(CapturedOutput {
            exit_code: status.code(),
            stdout: stdout.bytes,
            stderr: stderr.bytes,
        })
    }
}

#[cfg(windows)]
fn configure_hidden_process(command: &mut Command) {
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn configure_hidden_process(_command: &mut Command) {}

fn map_spawn_error(error: io::Error) -> RunnerError {
    match error.kind() {
        io::ErrorKind::NotFound => RunnerError::ExecutableMissing,
        io::ErrorKind::PermissionDenied => RunnerError::PermissionDenied,
        _ => RunnerError::Io,
    }
}

struct CappedBytes {
    bytes: Vec<u8>,
    exceeded: bool,
}

fn read_capped(mut reader: impl Read, limit: usize) -> Result<CappedBytes, RunnerError> {
    let mut bytes = Vec::with_capacity(limit.min(8192));
    let mut buffer = [0_u8; 8192];
    let mut exceeded = false;
    loop {
        let count = reader.read(&mut buffer).map_err(|_| RunnerError::Io)?;
        if count == 0 {
            break;
        }
        let remaining = limit.saturating_sub(bytes.len());
        let retained = remaining.min(count);
        bytes.extend_from_slice(&buffer[..retained]);
        exceeded |= retained < count;
    }
    Ok(CappedBytes { bytes, exceeded })
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CommandExitCategory {
    Success,
    NonZero,
    Timeout,
    OutputTooLarge,
    SpawnFailure,
    Ambiguous,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CommandOutcome {
    Success(CapturedOutput),
    Failed {
        error_code: TailscaleErrorCode,
        exit_category: CommandExitCategory,
    },
    Ambiguous {
        error_code: TailscaleErrorCode,
        exit_category: CommandExitCategory,
    },
}

pub fn execute_allowlisted<R: TailscaleRunner>(
    runner: &R,
    executable: &ResolvedExecutable,
    command: &TailscaleCommand,
    limits: RunLimits,
) -> CommandOutcome {
    match runner.run(executable, command, limits) {
        Ok(output) if output.exit_code == Some(0) => CommandOutcome::Success(output),
        Ok(_) if command.is_mutating() => CommandOutcome::Ambiguous {
            error_code: TailscaleErrorCode::AmbiguousOutcome,
            exit_category: CommandExitCategory::Ambiguous,
        },
        Ok(_) => CommandOutcome::Failed {
            error_code: TailscaleErrorCode::CommandFailed,
            exit_category: CommandExitCategory::NonZero,
        },
        Err(RunnerError::Timeout) if command.is_mutating() => CommandOutcome::Ambiguous {
            error_code: TailscaleErrorCode::AmbiguousOutcome,
            exit_category: CommandExitCategory::Ambiguous,
        },
        Err(RunnerError::Timeout) => CommandOutcome::Failed {
            error_code: TailscaleErrorCode::CommandTimeout,
            exit_category: CommandExitCategory::Timeout,
        },
        Err(RunnerError::OutputTooLarge) => CommandOutcome::Failed {
            error_code: TailscaleErrorCode::OutputTooLarge,
            exit_category: CommandExitCategory::OutputTooLarge,
        },
        Err(RunnerError::ExecutableMissing) => CommandOutcome::Failed {
            error_code: TailscaleErrorCode::NotInstalled,
            exit_category: CommandExitCategory::SpawnFailure,
        },
        Err(RunnerError::PermissionDenied) => CommandOutcome::Failed {
            error_code: TailscaleErrorCode::PermissionDenied,
            exit_category: CommandExitCategory::SpawnFailure,
        },
        Err(RunnerError::Io) => CommandOutcome::Failed {
            error_code: TailscaleErrorCode::DaemonUnavailable,
            exit_category: CommandExitCategory::SpawnFailure,
        },
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StatusSnapshot {
    pub version: SemanticVersion,
    pub backend_state: String,
    pub online: Option<bool>,
    pub dns_name_available: bool,
    pub dns_name: Option<String>,
}

pub fn parse_status_json(raw: &[u8]) -> Result<StatusSnapshot, TailscaleErrorCode> {
    ensure_bounded(raw, MAX_JSON_BYTES)?;
    let value: Value =
        serde_json::from_slice(raw).map_err(|_| TailscaleErrorCode::MalformedOutput)?;
    let object = value
        .as_object()
        .ok_or(TailscaleErrorCode::MalformedOutput)?;
    let version = object
        .get("Version")
        .and_then(Value::as_str)
        .ok_or(TailscaleErrorCode::MalformedOutput)
        .and_then(SemanticVersion::parse)?;
    let backend_state = object
        .get("BackendState")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or(TailscaleErrorCode::MalformedOutput)?
        .to_string();

    if backend_state != "Running" {
        return Ok(StatusSnapshot {
            version,
            backend_state,
            online: None,
            dns_name_available: false,
            dns_name: None,
        });
    }

    let self_status = object
        .get("Self")
        .and_then(Value::as_object)
        .ok_or(TailscaleErrorCode::MalformedOutput)?;
    let online = self_status
        .get("Online")
        .and_then(Value::as_bool)
        .ok_or(TailscaleErrorCode::MalformedOutput)?;
    let dns_name = self_status
        .get("DNSName")
        .and_then(Value::as_str)
        .ok_or(TailscaleErrorCode::MalformedOutput)?;
    Ok(StatusSnapshot {
        version,
        backend_state,
        online: Some(online),
        dns_name_available: !dns_name.trim_matches('.').is_empty(),
        dns_name: Some(dns_name.trim_end_matches('.').to_string()),
    })
}

pub fn classify_status(snapshot: &StatusSnapshot) -> TailscaleReadiness {
    let (state, error_code) = if !snapshot.version.is_supported() {
        (
            TailscaleReadinessState::UnsupportedVersion,
            Some(TailscaleErrorCode::UnsupportedVersion),
        )
    } else {
        match snapshot.backend_state.as_str() {
            "NeedsLogin" | "NoState" => (
                TailscaleReadinessState::SignedOut,
                Some(TailscaleErrorCode::NotSignedIn),
            ),
            "Running" if snapshot.online == Some(false) => (
                TailscaleReadinessState::Offline,
                Some(TailscaleErrorCode::Offline),
            ),
            "Running" if !snapshot.dns_name_available => (
                TailscaleReadinessState::MissingDns,
                Some(TailscaleErrorCode::MissingDns),
            ),
            "Running" if snapshot.online == Some(true) => (TailscaleReadinessState::Ready, None),
            "Stopped" => (
                TailscaleReadinessState::Offline,
                Some(TailscaleErrorCode::Offline),
            ),
            _ => (
                TailscaleReadinessState::DaemonUnavailable,
                Some(TailscaleErrorCode::DaemonUnavailable),
            ),
        }
    };

    TailscaleReadiness {
        state,
        installed_version: Some(snapshot.version),
        minimum_supported_version: MINIMUM_SUPPORTED_VERSION,
        backend_state: Some(snapshot.backend_state.clone()),
        online: snapshot.online,
        dns_name_available: snapshot.dns_name_available,
        error_code,
    }
}

pub fn classify_consent_required(
    mut readiness: TailscaleReadiness,
    consent_url: &SafeSetupUrl,
) -> TailscaleReadiness {
    let _validated_destination = consent_url.as_str();
    readiness.state = TailscaleReadinessState::ConsentRequired;
    readiness.error_code = Some(TailscaleErrorCode::ConsentRequired);
    readiness
}

pub fn readiness_from_runner_error(error: RunnerError) -> TailscaleReadiness {
    let (state, error_code) = match error {
        RunnerError::ExecutableMissing => (
            TailscaleReadinessState::Missing,
            TailscaleErrorCode::NotInstalled,
        ),
        RunnerError::PermissionDenied => (
            TailscaleReadinessState::PermissionDenied,
            TailscaleErrorCode::PermissionDenied,
        ),
        RunnerError::Timeout | RunnerError::Io => (
            TailscaleReadinessState::DaemonUnavailable,
            TailscaleErrorCode::DaemonUnavailable,
        ),
        RunnerError::OutputTooLarge => (
            TailscaleReadinessState::DaemonUnavailable,
            TailscaleErrorCode::OutputTooLarge,
        ),
    };
    TailscaleReadiness {
        state,
        installed_version: None,
        minimum_supported_version: MINIMUM_SUPPORTED_VERSION,
        backend_state: None,
        online: None,
        dns_name_available: false,
        error_code: Some(error_code),
    }
}

#[derive(Clone, Eq, PartialEq)]
pub struct SafeSetupUrl(String);

impl SafeSetupUrl {
    pub fn parse(raw: &str) -> Result<Self, TailscaleErrorCode> {
        if raw.len() > 2048
            || raw.trim() != raw
            || raw.chars().any(char::is_control)
            || raw.contains('#')
        {
            return Err(TailscaleErrorCode::MalformedOutput);
        }
        let remainder = raw
            .strip_prefix("https://")
            .ok_or(TailscaleErrorCode::MalformedOutput)?;
        let authority_end = remainder.find(['/', '?']).unwrap_or(remainder.len());
        let authority = &remainder[..authority_end];
        if authority != "login.tailscale.com" || authority.contains('@') {
            return Err(TailscaleErrorCode::MalformedOutput);
        }
        Ok(Self(raw.to_string()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn diagnostic_form(&self) -> String {
        "https://login.tailscale.com/[redacted]".to_string()
    }
}

impl std::fmt::Debug for SafeSetupUrl {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_tuple("SafeSetupUrl")
            .field(&self.diagnostic_form())
            .finish()
    }
}

pub fn parse_consent_url(raw: &str) -> Result<Option<SafeSetupUrl>, TailscaleErrorCode> {
    ensure_bounded(raw.as_bytes(), MAX_CAPTURE_BYTES)?;
    for token in raw.split_whitespace() {
        let candidate = token.trim_matches(|character: char| {
            matches!(character, '"' | '\'' | '(' | ')' | '<' | '>' | ',' | ';')
        });
        if candidate.starts_with("https://") {
            return SafeSetupUrl::parse(candidate).map(Some);
        }
    }
    Ok(None)
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ServeSource {
    Background,
    Foreground,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CanonicalServeMapping {
    pub https_port: u16,
    pub path: String,
    pub proxy_target: String,
    pub source: ServeSource,
}

impl CanonicalServeMapping {
    pub fn fingerprint(&self) -> String {
        let canonical = serde_json::to_vec(self).expect("canonical Serve mapping serializes");
        let digest = Sha256::digest(canonical);
        digest.iter().map(|byte| format!("{byte:02x}")).collect()
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ServeConfigView {
    pub selected_mapping: Option<CanonicalServeMapping>,
    pub selected_conflict: bool,
    pub unrelated_mapping_count: usize,
    pub services_present: bool,
    pub funnel_present: bool,
    pub foreground_present: bool,
}

impl ServeConfigView {
    fn empty() -> Self {
        Self {
            selected_mapping: None,
            selected_conflict: false,
            unrelated_mapping_count: 0,
            services_present: false,
            funnel_present: false,
            foreground_present: false,
        }
    }
}

pub fn parse_serve_status_json(raw: &[u8]) -> Result<ServeConfigView, TailscaleErrorCode> {
    ensure_bounded(raw, MAX_JSON_BYTES)?;
    let value: Value =
        serde_json::from_slice(raw).map_err(|_| TailscaleErrorCode::MalformedOutput)?;
    parse_serve_config_value(&value, true)
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ServiceConfigSummary {
    pub schema_version: String,
    pub service_count: usize,
    pub managed_port_in_use: bool,
}

pub fn parse_service_config_json(raw: &[u8]) -> Result<ServiceConfigSummary, TailscaleErrorCode> {
    ensure_bounded(raw, MAX_JSON_BYTES)?;
    let value: Value =
        serde_json::from_slice(raw).map_err(|_| TailscaleErrorCode::MalformedOutput)?;
    let object = value
        .as_object()
        .ok_or(TailscaleErrorCode::MalformedOutput)?;
    let schema_version = object
        .get("version")
        .and_then(Value::as_str)
        .filter(|version| !version.is_empty())
        .ok_or(TailscaleErrorCode::MalformedOutput)?
        .to_string();
    let services = object
        .get("services")
        .and_then(Value::as_object)
        .ok_or(TailscaleErrorCode::MalformedOutput)?;
    let mut managed_port_in_use = false;
    for service in services.values() {
        let service = service
            .as_object()
            .ok_or(TailscaleErrorCode::MalformedOutput)?;
        let endpoints = service
            .get("endpoints")
            .and_then(Value::as_object)
            .ok_or(TailscaleErrorCode::MalformedOutput)?;
        for (endpoint, target) in endpoints {
            if !target.is_string() {
                return Err(TailscaleErrorCode::MalformedOutput);
            }
            if endpoint == &format!("tcp:{MANAGED_HTTPS_PORT}") {
                managed_port_in_use = true;
            }
        }
    }
    Ok(ServiceConfigSummary {
        schema_version,
        service_count: services.len(),
        managed_port_in_use,
    })
}

pub fn access_url_from_dns_name(dns_name: Option<&str>) -> Option<String> {
    let host = dns_name?.trim_end_matches('.').to_ascii_lowercase();
    if host.len() > 253 || !host.ends_with(".ts.net") {
        return None;
    }
    let labels_valid = host.split('.').all(|label| {
        !label.is_empty()
            && label.len() <= 63
            && !label.starts_with('-')
            && !label.ends_with('-')
            && label
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
    });
    labels_valid.then(|| format!("https://{host}/"))
}

pub fn unrelated_serve_fingerprint(
    raw: &[u8],
    managed_mapping: &CanonicalServeMapping,
) -> Result<String, TailscaleErrorCode> {
    ensure_bounded(raw, MAX_JSON_BYTES)?;
    let mut value: Value =
        serde_json::from_slice(raw).map_err(|_| TailscaleErrorCode::MalformedOutput)?;
    let view = parse_serve_config_value(&value, true)?;
    if view.selected_mapping.as_ref() == Some(managed_mapping) && !view.selected_conflict {
        remove_managed_mapping(&mut value)?;
    }
    Ok(fingerprint_json(&value))
}

pub fn service_config_fingerprint(raw: &[u8]) -> Result<String, TailscaleErrorCode> {
    parse_service_config_json(raw)?;
    let value: Value =
        serde_json::from_slice(raw).map_err(|_| TailscaleErrorCode::MalformedOutput)?;
    Ok(fingerprint_json(&value))
}

fn remove_managed_mapping(value: &mut Value) -> Result<(), TailscaleErrorCode> {
    let object = value
        .as_object_mut()
        .ok_or(TailscaleErrorCode::MalformedOutput)?;
    if let Some(tcp) = object.get_mut("TCP").and_then(Value::as_object_mut) {
        tcp.remove(&MANAGED_HTTPS_PORT.to_string());
        if tcp.is_empty() {
            object.remove("TCP");
        }
    }

    if let Some(web) = object.get_mut("Web").and_then(Value::as_object_mut) {
        let selected_hosts: Vec<String> = web
            .keys()
            .filter(|host_port| host_port_port(host_port) == Some(MANAGED_HTTPS_PORT))
            .cloned()
            .collect();
        for host in selected_hosts {
            let remove_host =
                if let Some(server) = web.get_mut(&host).and_then(Value::as_object_mut) {
                    let handlers = server
                        .get_mut("Handlers")
                        .and_then(Value::as_object_mut)
                        .ok_or(TailscaleErrorCode::MalformedOutput)?;
                    handlers.remove(MANAGED_PATH);
                    handlers.is_empty()
                } else {
                    false
                };
            if remove_host {
                web.remove(&host);
            }
        }
        if web.is_empty() {
            object.remove("Web");
        }
    }
    Ok(())
}

fn fingerprint_json(value: &Value) -> String {
    let mut canonical = Vec::new();
    write_canonical_json(value, &mut canonical);
    let digest = Sha256::digest(canonical);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn write_canonical_json(value: &Value, output: &mut Vec<u8>) {
    match value {
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => {
            output.extend(serde_json::to_vec(value).expect("JSON scalar serializes"));
        }
        Value::Array(values) => {
            output.push(b'[');
            for value in values {
                write_canonical_json(value, output);
                output.push(b',');
            }
            output.push(b']');
        }
        Value::Object(object) => {
            output.push(b'{');
            let mut keys: Vec<&String> = object.keys().collect();
            keys.sort_unstable();
            for key in keys {
                output.extend(serde_json::to_vec(key).expect("JSON key serializes"));
                output.push(b':');
                write_canonical_json(&object[key], output);
                output.push(b',');
            }
            output.push(b'}');
        }
    }
}

fn parse_serve_config_value(
    value: &Value,
    inspect_foreground: bool,
) -> Result<ServeConfigView, TailscaleErrorCode> {
    let object = value
        .as_object()
        .ok_or(TailscaleErrorCode::MalformedOutput)?;
    let mut view = ServeConfigView::empty();

    let tcp = optional_object(object.get("TCP"))?;
    let selected_tcp = tcp.and_then(|ports| ports.get(&MANAGED_HTTPS_PORT.to_string()));
    let selected_tcp_https = match selected_tcp {
        Some(handler) => {
            let handler = handler
                .as_object()
                .ok_or(TailscaleErrorCode::MalformedOutput)?;
            match handler.get("HTTPS") {
                Some(Value::Bool(true))
                    if !handler.contains_key("HTTP") && !handler.contains_key("TCPForward") =>
                {
                    true
                }
                Some(Value::Bool(true)) => {
                    view.selected_conflict = true;
                    false
                }
                Some(Value::Bool(false)) | None => {
                    view.selected_conflict = true;
                    false
                }
                Some(_) => return Err(TailscaleErrorCode::MalformedOutput),
            }
        }
        None => false,
    };

    if let Some(ports) = tcp {
        for (port, handler) in ports {
            if port != &MANAGED_HTTPS_PORT.to_string() {
                if !handler.is_object() {
                    return Err(TailscaleErrorCode::MalformedOutput);
                }
                view.unrelated_mapping_count += 1;
            }
        }
    }

    let mut selected_candidates = Vec::new();
    if let Some(web) = optional_object(object.get("Web"))? {
        for (host_port, server) in web {
            let port = host_port_port(host_port).ok_or(TailscaleErrorCode::MalformedOutput)?;
            let server = server
                .as_object()
                .ok_or(TailscaleErrorCode::MalformedOutput)?;
            let handlers = server
                .get("Handlers")
                .and_then(Value::as_object)
                .ok_or(TailscaleErrorCode::MalformedOutput)?;
            for (path, handler) in handlers {
                let handler = handler
                    .as_object()
                    .ok_or(TailscaleErrorCode::MalformedOutput)?;
                if port == MANAGED_HTTPS_PORT && path == MANAGED_PATH {
                    let proxy = handler
                        .get("Proxy")
                        .and_then(Value::as_str)
                        .ok_or(TailscaleErrorCode::MalformedOutput)?;
                    if !selected_tcp_https {
                        view.selected_conflict = true;
                        continue;
                    }
                    selected_candidates.push(CanonicalServeMapping {
                        https_port: MANAGED_HTTPS_PORT,
                        path: MANAGED_PATH.to_string(),
                        proxy_target: normalize_proxy_target(proxy)?,
                        source: ServeSource::Background,
                    });
                } else {
                    view.unrelated_mapping_count += 1;
                }
            }
        }
    }

    if selected_candidates.len() == 1 {
        view.selected_mapping = selected_candidates.pop();
    } else if selected_candidates.len() > 1 {
        view.selected_conflict = true;
    }

    if let Some(funnel) = optional_object(object.get("AllowFunnel"))? {
        for (host_port, enabled) in funnel {
            let enabled = enabled
                .as_bool()
                .ok_or(TailscaleErrorCode::MalformedOutput)?;
            if enabled {
                view.funnel_present = true;
                if host_port_port(host_port) == Some(MANAGED_HTTPS_PORT) {
                    view.selected_conflict = true;
                } else {
                    view.unrelated_mapping_count += 1;
                }
            }
        }
    }

    if let Some(services) = optional_object(object.get("Services"))? {
        view.services_present = !services.is_empty();
        for service in services.values() {
            if config_uses_tcp_port(service, MANAGED_HTTPS_PORT)? {
                view.selected_conflict = true;
            }
            let service_view = parse_serve_config_value(service, false)?;
            if service_view.selected_mapping.is_some() || service_view.selected_conflict {
                view.selected_conflict = true;
            } else {
                view.unrelated_mapping_count += service_view.unrelated_mapping_count.max(1);
            }
        }
    }

    if inspect_foreground {
        if let Some(foreground) = optional_object(object.get("Foreground"))? {
            view.foreground_present = !foreground.is_empty();
            for foreground_config in foreground.values() {
                if config_uses_tcp_port(foreground_config, MANAGED_HTTPS_PORT)? {
                    view.selected_conflict = true;
                }
                let foreground_view = parse_serve_config_value(foreground_config, false)?;
                if foreground_view.selected_mapping.is_some() || foreground_view.selected_conflict {
                    view.selected_conflict = true;
                } else {
                    view.unrelated_mapping_count += foreground_view.unrelated_mapping_count.max(1);
                }
            }
        }
    }

    Ok(view)
}

fn config_uses_tcp_port(value: &Value, port: u16) -> Result<bool, TailscaleErrorCode> {
    let object = value
        .as_object()
        .ok_or(TailscaleErrorCode::MalformedOutput)?;
    Ok(optional_object(object.get("TCP"))?
        .is_some_and(|ports| ports.contains_key(&port.to_string())))
}

fn optional_object(
    value: Option<&Value>,
) -> Result<Option<&serde_json::Map<String, Value>>, TailscaleErrorCode> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Object(object)) => Ok(Some(object)),
        Some(_) => Err(TailscaleErrorCode::MalformedOutput),
    }
}

fn host_port_port(host_port: &str) -> Option<u16> {
    host_port
        .rsplit_once(':')
        .and_then(|(_, port)| port.parse::<u16>().ok())
}

fn normalize_proxy_target(proxy: &str) -> Result<String, TailscaleErrorCode> {
    if proxy.is_empty() || proxy.len() > 2048 || proxy.chars().any(char::is_control) {
        return Err(TailscaleErrorCode::MalformedOutput);
    }
    Ok(proxy.strip_suffix('/').unwrap_or(proxy).to_string())
}

pub fn classify_ownership(
    view: &ServeConfigView,
    expected_fingerprint: Option<&str>,
) -> ServeOwnership {
    if view.selected_conflict
        || expected_fingerprint.is_some_and(|fingerprint| !valid_fingerprint(fingerprint))
    {
        return ServeOwnership::Ambiguous;
    }
    match (&view.selected_mapping, expected_fingerprint) {
        (None, None) => ServeOwnership::Absent,
        (None, Some(_)) => ServeOwnership::OwnedDrifted,
        (Some(_), None) => ServeOwnership::OccupiedUnowned,
        (Some(mapping), Some(expected)) if mapping.fingerprint() == expected => {
            ServeOwnership::OwnedExact
        }
        (Some(_), Some(_)) => ServeOwnership::OwnedDrifted,
    }
}

fn valid_fingerprint(fingerprint: &str) -> bool {
    fingerprint.len() == 64
        && fingerprint
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TailscaleAccessConfig {
    pub schema_version: u32,
    pub desired_enabled: bool,
    pub managed_https_port: u16,
    pub managed_path: String,
    pub managed_target: Option<String>,
    pub mapping_fingerprint: Option<String>,
}

impl TailscaleAccessConfig {
    pub fn disabled() -> Self {
        Self {
            schema_version: STATE_SCHEMA_VERSION,
            desired_enabled: false,
            managed_https_port: MANAGED_HTTPS_PORT,
            managed_path: MANAGED_PATH.to_string(),
            managed_target: None,
            mapping_fingerprint: None,
        }
    }

    pub fn enabled(mapping: &ManagedMapping) -> Self {
        let canonical = mapping.canonical();
        Self {
            schema_version: STATE_SCHEMA_VERSION,
            desired_enabled: true,
            managed_https_port: MANAGED_HTTPS_PORT,
            managed_path: MANAGED_PATH.to_string(),
            managed_target: Some(mapping.target()),
            mapping_fingerprint: Some(canonical.fingerprint()),
        }
    }

    pub fn validate(&self) -> Result<(), StateErrorCode> {
        if self.schema_version != STATE_SCHEMA_VERSION {
            return Err(StateErrorCode::UnknownVersion);
        }
        if self.managed_https_port != MANAGED_HTTPS_PORT || self.managed_path != MANAGED_PATH {
            return Err(StateErrorCode::StaleOwnership);
        }
        match (
            self.desired_enabled,
            self.managed_target.as_deref(),
            self.mapping_fingerprint.as_deref(),
        ) {
            (false, None, None) => Ok(()),
            (true, Some(target), Some(fingerprint))
                if managed_target_port(target).is_some() && valid_fingerprint(fingerprint) =>
            {
                Ok(())
            }
            _ => Err(StateErrorCode::StaleOwnership),
        }
    }

    pub fn managed_mapping(&self) -> Option<ManagedMapping> {
        self.managed_target
            .as_deref()
            .and_then(managed_target_port)
            .and_then(|port| ManagedMapping::new(port).ok())
    }
}

fn managed_target_port(target: &str) -> Option<u16> {
    let port = target.strip_prefix("http://127.0.0.1:")?.parse().ok()?;
    (MANAGED_LOOPBACK_PORT_START..=MANAGED_LOOPBACK_PORT_END)
        .contains(&port)
        .then_some(port)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StateErrorCode {
    Malformed,
    UnknownVersion,
    StaleOwnership,
    TooLarge,
    Io,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum StateLoad {
    Missing,
    Loaded(TailscaleAccessConfig),
}

pub fn state_path(config_root: &Path) -> PathBuf {
    config_root.join("tailscale-access.json")
}

pub fn load_state(path: &Path) -> Result<StateLoad, StateErrorCode> {
    let metadata = match fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(StateLoad::Missing),
        Err(_) => return Err(StateErrorCode::Io),
    };
    if metadata.len() > MAX_STATE_BYTES as u64 {
        return Err(StateErrorCode::TooLarge);
    }
    let raw = fs::read(path).map_err(|_| StateErrorCode::Io)?;
    let value: Value = serde_json::from_slice(&raw).map_err(|_| StateErrorCode::Malformed)?;
    let schema_version = value
        .get("schemaVersion")
        .and_then(Value::as_u64)
        .ok_or(StateErrorCode::Malformed)?;
    if schema_version != u64::from(STATE_SCHEMA_VERSION) {
        return Err(StateErrorCode::UnknownVersion);
    }
    let state: TailscaleAccessConfig =
        serde_json::from_value(value).map_err(|_| StateErrorCode::Malformed)?;
    state.validate()?;
    Ok(StateLoad::Loaded(state))
}

static TEMP_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);

pub fn save_state_atomic(path: &Path, state: &TailscaleAccessConfig) -> Result<(), StateErrorCode> {
    state.validate()?;
    let parent = path.parent().ok_or(StateErrorCode::Io)?;
    fs::create_dir_all(parent).map_err(|_| StateErrorCode::Io)?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or(StateErrorCode::Io)?;
    let counter = TEMP_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
    let temporary = parent.join(format!(
        ".{file_name}.{}.{}.tmp",
        std::process::id(),
        counter
    ));
    let result = (|| {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        options.mode(0o600);
        let mut file = options.open(&temporary).map_err(|_| StateErrorCode::Io)?;
        let mut serialized = serde_json::to_vec_pretty(state).map_err(|_| StateErrorCode::Io)?;
        serialized.push(b'\n');
        file.write_all(&serialized)
            .map_err(|_| StateErrorCode::Io)?;
        file.sync_all().map_err(|_| StateErrorCode::Io)?;
        atomic_replace(&temporary, path).map_err(|_| StateErrorCode::Io)?;
        sync_parent(parent);
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

#[cfg(not(windows))]
fn atomic_replace(source: &Path, destination: &Path) -> io::Result<()> {
    fs::rename(source, destination)
}

#[cfg(windows)]
fn atomic_replace(source: &Path, destination: &Path) -> io::Result<()> {
    const MOVEFILE_REPLACE_EXISTING: u32 = 0x1;
    const MOVEFILE_WRITE_THROUGH: u32 = 0x8;
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn MoveFileExW(existing: *const u16, new: *const u16, flags: u32) -> i32;
    }
    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    let result = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(unix)]
fn sync_parent(parent: &Path) {
    if let Ok(directory) = File::open(parent) {
        let _ = directory.sync_all();
    }
}

#[cfg(not(unix))]
fn sync_parent(_parent: &Path) {}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DiagnosticAction {
    Inspect,
    Enable,
    Retry,
    Disable,
    Startup,
    Shutdown,
    LoadState,
    SaveState,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticEvent {
    pub operation_id: String,
    pub action: DiagnosticAction,
    pub prior_state: Option<TailscaleAccessState>,
    pub desired_enabled: Option<bool>,
    pub readiness: Option<TailscaleReadinessState>,
    pub ownership: Option<ServeOwnership>,
    pub command_kind: Option<TailscaleCommandKind>,
    pub exit_category: Option<CommandExitCategory>,
    pub error_code: Option<TailscaleErrorCode>,
    pub external_change: Option<bool>,
    pub post_state: Option<TailscaleAccessState>,
    pub decision: Option<String>,
    pub corrective_action: Option<String>,
}

impl DiagnosticEvent {
    pub fn new(operation_id: &str, action: DiagnosticAction) -> Self {
        Self {
            operation_id: sanitize_operation_id(operation_id),
            action,
            prior_state: None,
            desired_enabled: None,
            readiness: None,
            ownership: None,
            command_kind: None,
            exit_category: None,
            error_code: None,
            external_change: None,
            post_state: None,
            decision: None,
            corrective_action: None,
        }
    }

    pub fn to_json_line(&self) -> String {
        serde_json::to_string(self).expect("structured diagnostic serializes")
    }
}

fn sanitize_operation_id(operation_id: &str) -> String {
    if operation_id.len() <= 64
        && !operation_id.is_empty()
        && operation_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        operation_id.to_string()
    } else {
        "redacted".to_string()
    }
}

pub fn sanitize_external_detail(detail: &str) -> &'static str {
    let lower = detail.to_ascii_lowercase();
    if detail.contains('@')
        || lower.contains("http://")
        || lower.contains("https://")
        || lower.contains("token")
        || lower.contains("cookie")
        || lower.contains("tskey-")
        || contains_hex_digest(detail)
    {
        "external detail redacted"
    } else {
        "external command detail omitted"
    }
}

fn contains_hex_digest(detail: &str) -> bool {
    detail
        .split(|character: char| !character.is_ascii_hexdigit())
        .any(|token| token.len() >= 32)
}

fn ensure_bounded(raw: &[u8], limit: usize) -> Result<(), TailscaleErrorCode> {
    if raw.len() > limit {
        Err(TailscaleErrorCode::OutputTooLarge)
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{collections::VecDeque, io::Cursor};

    const READY_STATUS: &str =
        include_str!("../fixtures/tailscale/windows-1.98.8-status-ready.json");
    const WINDOWS_VERSION: &str = include_str!("../fixtures/tailscale/windows-1.98.8-version.txt");
    const EMPTY_SERVE: &str = include_str!("../fixtures/tailscale/windows-1.98.8-serve-empty.json");
    const SIGNED_OUT_STATUS: &str = include_str!("../fixtures/tailscale/status-signed-out.json");
    const OFFLINE_STATUS: &str = include_str!("../fixtures/tailscale/status-offline.json");
    const MISSING_DNS_STATUS: &str = include_str!("../fixtures/tailscale/status-missing-dns.json");
    const CONSENT_REQUIRED: &str =
        include_str!("../fixtures/tailscale/windows-1.98.8-consent-required.txt");
    const COMPATIBLE_SERVE: &str = include_str!("../fixtures/tailscale/serve-compatible-root.json");
    const OCCUPIED_SERVE: &str = include_str!("../fixtures/tailscale/serve-occupied-root.json");
    const UNRELATED_SERVE: &str = include_str!("../fixtures/tailscale/serve-unrelated.json");
    const SERVICE_CONFLICT: &str =
        include_str!("../fixtures/tailscale/serve-service-conflict.json");
    const FUNNEL_CONFLICT: &str = include_str!("../fixtures/tailscale/serve-funnel-conflict.json");
    const AMBIGUOUS_SERVE: &str = include_str!("../fixtures/tailscale/serve-ambiguous.json");
    const MALFORMED_SERVE: &str = include_str!("../fixtures/tailscale/serve-malformed.txt");
    const TRUNCATED_SERVE: &str = include_str!("../fixtures/tailscale/serve-truncated.txt");
    const EMPTY_SERVICE_CONFIG: &str =
        include_str!("../fixtures/tailscale/service-config-empty.json");
    const SELECTED_SERVICE_CONFIG: &str =
        include_str!("../fixtures/tailscale/service-config-selected.json");
    const UNRELATED_SERVICE_CONFIG: &str =
        include_str!("../fixtures/tailscale/service-config-unrelated.json");

    #[test]
    fn version_policy_accepts_initial_windows_contract_and_rejects_older_clients() {
        assert_eq!(
            SemanticVersion::parse(WINDOWS_VERSION).unwrap(),
            MINIMUM_SUPPORTED_VERSION
        );
        assert!(SemanticVersion::parse("1.98.9-t123-g456")
            .unwrap()
            .is_supported());
        assert!(!SemanticVersion::parse("1.98.7").unwrap().is_supported());
        assert_eq!(
            SemanticVersion::parse("1.98"),
            Err(TailscaleErrorCode::MalformedOutput)
        );
    }

    #[test]
    fn executable_discovery_distinguishes_missing_and_permission_denied() {
        let root = test_directory("discovery");
        let missing = root.join("missing");
        assert_eq!(
            select_executable(vec![missing]),
            Err(DiscoveryError::Missing)
        );

        let blocked = root.join("tailscale");
        fs::write(&blocked, b"fixture").unwrap();
        #[cfg(unix)]
        fs::set_permissions(&blocked, fs::Permissions::from_mode(0o600)).unwrap();
        #[cfg(unix)]
        assert_eq!(
            select_executable(vec![blocked]),
            Err(DiscoveryError::PermissionDenied)
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn windows_and_macos_discovery_contracts_use_only_fixed_locations_and_path() {
        let windows = executable_candidates(SupportedPlatform::Windows);
        let macos = executable_candidates(SupportedPlatform::MacOs);
        assert!(macos
            .iter()
            .any(|path| path == Path::new("/Applications/Tailscale.app/Contents/MacOS/Tailscale")));
        assert!(macos
            .iter()
            .any(|path| path == Path::new("/opt/homebrew/bin/tailscale")));
        assert!(windows.iter().all(|path| path
            .file_name()
            .is_some_and(|name| name.eq_ignore_ascii_case("tailscale.exe"))));
    }

    #[test]
    fn command_builders_emit_only_locked_argument_arrays() {
        let mapping = ManagedMapping::new(18108).unwrap();
        assert_eq!(strings(TailscaleCommand::Version.args()), ["version"]);
        assert_eq!(
            strings(TailscaleCommand::StatusJson.args()),
            ["status", "--json"]
        );
        assert_eq!(
            strings(TailscaleCommand::ServeStatusJson.args()),
            ["serve", "status", "--json"]
        );
        assert_eq!(
            strings(TailscaleCommand::ServeGetConfigAll.args()),
            ["serve", "get-config", "--all"]
        );
        assert_eq!(
            strings(TailscaleCommand::Enable(mapping).args()),
            ["serve", "--bg", "--https=443", "http://127.0.0.1:18108"]
        );
        assert_eq!(
            strings(TailscaleCommand::Disable.args()),
            ["serve", "--https=443", "off"]
        );
    }

    #[test]
    fn unsafe_command_forms_are_not_representable() {
        assert_eq!(
            ManagedMapping::new(18107),
            Err(TailscaleErrorCode::Internal)
        );
        let commands = [
            TailscaleCommand::Version,
            TailscaleCommand::StatusJson,
            TailscaleCommand::ServeStatusJson,
            TailscaleCommand::ServeGetConfigAll,
            TailscaleCommand::Enable(ManagedMapping::new(18127).unwrap()),
            TailscaleCommand::Disable,
        ];
        for command in commands {
            let joined = strings(command.args()).join(" ").to_ascii_lowercase();
            assert!(!joined.contains("reset"));
            assert!(!joined.contains("funnel"));
            assert!(!joined.contains("set-config"));
            assert!(!joined.contains("0.0.0.0"));
            assert!(!joined.contains([';', '|', '&', '`']));
        }
    }

    #[test]
    fn status_fixtures_classify_every_readiness_state() {
        let ready = classify_status(&parse_status_json(READY_STATUS.as_bytes()).unwrap());
        assert_eq!(ready.state, TailscaleReadinessState::Ready);
        assert_eq!(ready.installed_version, Some(MINIMUM_SUPPORTED_VERSION));

        let signed_out = classify_status(&parse_status_json(SIGNED_OUT_STATUS.as_bytes()).unwrap());
        assert_eq!(signed_out.state, TailscaleReadinessState::SignedOut);
        assert_eq!(signed_out.error_code, Some(TailscaleErrorCode::NotSignedIn));

        let offline = classify_status(&parse_status_json(OFFLINE_STATUS.as_bytes()).unwrap());
        assert_eq!(offline.state, TailscaleReadinessState::Offline);

        let missing_dns =
            classify_status(&parse_status_json(MISSING_DNS_STATUS.as_bytes()).unwrap());
        assert_eq!(missing_dns.state, TailscaleReadinessState::MissingDns);

        assert_eq!(
            readiness_from_runner_error(RunnerError::ExecutableMissing).state,
            TailscaleReadinessState::Missing
        );
        assert_eq!(
            readiness_from_runner_error(RunnerError::PermissionDenied).state,
            TailscaleReadinessState::PermissionDenied
        );
        assert_eq!(
            readiness_from_runner_error(RunnerError::Io).state,
            TailscaleReadinessState::DaemonUnavailable
        );
    }

    #[test]
    fn status_parser_tolerates_extra_fields_but_rejects_critical_shape_changes() {
        let mut value: Value = serde_json::from_str(READY_STATUS).unwrap();
        value["FutureField"] = serde_json::json!({"nested": true});
        let parsed = parse_status_json(serde_json::to_string(&value).unwrap().as_bytes()).unwrap();
        assert_eq!(parsed.backend_state, "Running");

        value["Self"]["Online"] = Value::String("true".to_string());
        assert_eq!(
            parse_status_json(serde_json::to_string(&value).unwrap().as_bytes()),
            Err(TailscaleErrorCode::MalformedOutput)
        );
        assert_eq!(
            parse_status_json(br#"{"Version":"1.98.8","BackendState":"Running""#),
            Err(TailscaleErrorCode::MalformedOutput)
        );
        assert_eq!(
            parse_status_json(&vec![b' '; MAX_JSON_BYTES + 1]),
            Err(TailscaleErrorCode::OutputTooLarge)
        );
    }

    #[test]
    fn consent_url_is_validated_and_diagnostics_redact_its_query() {
        let consent = parse_consent_url(CONSENT_REQUIRED).unwrap().unwrap();
        assert!(consent.as_str().starts_with("https://login.tailscale.com/"));
        assert_eq!(
            consent.diagnostic_form(),
            "https://login.tailscale.com/[redacted]"
        );
        assert!(format!("{consent:?}").contains("[redacted]"));
        let ready = classify_status(&parse_status_json(READY_STATUS.as_bytes()).unwrap());
        let consent_readiness = classify_consent_required(ready, &consent);
        assert_eq!(
            consent_readiness.state,
            TailscaleReadinessState::ConsentRequired
        );
        assert_eq!(
            consent_readiness.error_code,
            Some(TailscaleErrorCode::ConsentRequired)
        );
        for unsafe_url in [
            "http://login.tailscale.com/admin/feature/serve",
            "https://evil.example/",
            "https://login.tailscale.com@evil.example/",
            "https://login.tailscale.com/path#fragment",
        ] {
            assert_eq!(
                SafeSetupUrl::parse(unsafe_url),
                Err(TailscaleErrorCode::MalformedOutput)
            );
        }
    }

    #[test]
    fn serve_fixtures_classify_absent_exact_unowned_drifted_and_occupied() {
        let empty = parse_serve_status_json(EMPTY_SERVE.as_bytes()).unwrap();
        assert_eq!(classify_ownership(&empty, None), ServeOwnership::Absent);

        let compatible = parse_serve_status_json(COMPATIBLE_SERVE.as_bytes()).unwrap();
        assert_eq!(
            classify_ownership(&compatible, None),
            ServeOwnership::OccupiedUnowned
        );
        let fingerprint = compatible.selected_mapping.as_ref().unwrap().fingerprint();
        assert_eq!(
            classify_ownership(&compatible, Some(&fingerprint)),
            ServeOwnership::OwnedExact
        );

        let occupied = parse_serve_status_json(OCCUPIED_SERVE.as_bytes()).unwrap();
        assert_eq!(
            classify_ownership(&occupied, Some(&fingerprint)),
            ServeOwnership::OwnedDrifted
        );
        assert_eq!(
            classify_ownership(&occupied, None),
            ServeOwnership::OccupiedUnowned
        );
        assert_eq!(
            classify_ownership(&empty, Some(&fingerprint)),
            ServeOwnership::OwnedDrifted
        );
    }

    #[test]
    fn unrelated_paths_and_listeners_remain_available_without_occupying_root() {
        let view = parse_serve_status_json(UNRELATED_SERVE.as_bytes()).unwrap();
        assert_eq!(view.selected_mapping, None);
        assert!(!view.selected_conflict);
        assert!(view.unrelated_mapping_count >= 2);
        assert_eq!(classify_ownership(&view, None), ServeOwnership::Absent);
    }

    #[test]
    fn service_funnel_and_multiple_selected_mappings_are_ambiguous() {
        let service = parse_serve_status_json(SERVICE_CONFLICT.as_bytes()).unwrap();
        assert!(service.services_present);
        assert_eq!(
            classify_ownership(&service, None),
            ServeOwnership::Ambiguous
        );

        let funnel = parse_serve_status_json(FUNNEL_CONFLICT.as_bytes()).unwrap();
        assert!(funnel.funnel_present);
        assert_eq!(classify_ownership(&funnel, None), ServeOwnership::Ambiguous);

        let ambiguous = parse_serve_status_json(AMBIGUOUS_SERVE.as_bytes()).unwrap();
        assert_eq!(
            classify_ownership(&ambiguous, None),
            ServeOwnership::Ambiguous
        );
    }

    #[test]
    fn serve_parser_rejects_malformed_truncated_and_oversized_output() {
        assert_eq!(
            parse_serve_status_json(MALFORMED_SERVE.as_bytes()),
            Err(TailscaleErrorCode::MalformedOutput)
        );
        assert_eq!(
            parse_serve_status_json(TRUNCATED_SERVE.as_bytes()),
            Err(TailscaleErrorCode::MalformedOutput)
        );
        assert_eq!(
            parse_serve_status_json(&vec![b' '; MAX_JSON_BYTES + 1]),
            Err(TailscaleErrorCode::OutputTooLarge)
        );
    }

    #[test]
    fn service_config_parser_distinguishes_empty_selected_and_unrelated_services() {
        assert_eq!(
            parse_service_config_json(EMPTY_SERVICE_CONFIG.as_bytes()).unwrap(),
            ServiceConfigSummary {
                schema_version: "0.0.1".to_string(),
                service_count: 0,
                managed_port_in_use: false,
            }
        );
        let selected = parse_service_config_json(SELECTED_SERVICE_CONFIG.as_bytes()).unwrap();
        assert_eq!(selected.service_count, 1);
        assert!(selected.managed_port_in_use);

        let unrelated = parse_service_config_json(UNRELATED_SERVICE_CONFIG.as_bytes()).unwrap();
        assert_eq!(unrelated.service_count, 1);
        assert!(!unrelated.managed_port_in_use);

        let malformed =
            br#"{"version":"0.0.1","services":{"svc:bad":{"endpoints":{"tcp:443":false}}}}"#;
        assert_eq!(
            parse_service_config_json(malformed),
            Err(TailscaleErrorCode::MalformedOutput)
        );
    }

    #[test]
    fn unsupported_version_has_a_deterministic_readiness_classification() {
        let snapshot = StatusSnapshot {
            version: SemanticVersion::new(1, 98, 7),
            backend_state: "Running".to_string(),
            online: Some(true),
            dns_name_available: true,
            dns_name: Some("brain-host.example-tailnet.ts.net".to_string()),
        };
        let readiness = classify_status(&snapshot);
        assert_eq!(readiness.state, TailscaleReadinessState::UnsupportedVersion);
        assert_eq!(
            readiness.error_code,
            Some(TailscaleErrorCode::UnsupportedVersion)
        );
    }

    #[test]
    fn canonical_fingerprint_is_independent_of_json_format_and_map_order() {
        let reordered = r#"{
          "Web":{"brain-host.example-tailnet.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:18108/"}}}},
          "Ignored":{"z":1},
          "TCP":{"443":{"HTTPS":true}}
        }"#;
        let first = parse_serve_status_json(COMPATIBLE_SERVE.as_bytes()).unwrap();
        let second = parse_serve_status_json(reordered.as_bytes()).unwrap();
        assert_eq!(first.selected_mapping, second.selected_mapping);
        assert_eq!(
            first.selected_mapping.unwrap().fingerprint(),
            second.selected_mapping.unwrap().fingerprint()
        );
    }

    #[test]
    fn access_url_accepts_only_valid_tailscale_dns_names() {
        assert_eq!(
            access_url_from_dns_name(Some("Brain-Host.Example-Tailnet.ts.net.")),
            Some("https://brain-host.example-tailnet.ts.net/".to_string())
        );
        for rejected in [
            None,
            Some("example.com"),
            Some("-host.example.ts.net"),
            Some("host..example.ts.net"),
            Some("host_example.ts.net"),
        ] {
            assert_eq!(access_url_from_dns_name(rejected), None);
        }
    }

    #[test]
    fn unrelated_fingerprints_ignore_only_the_exact_managed_mapping() {
        let mapping = ManagedMapping::new(18108).unwrap();
        let empty =
            unrelated_serve_fingerprint(EMPTY_SERVE.as_bytes(), &mapping.canonical()).unwrap();
        let exact =
            unrelated_serve_fingerprint(COMPATIBLE_SERVE.as_bytes(), &mapping.canonical()).unwrap();
        assert_eq!(empty, exact);

        let unrelated =
            unrelated_serve_fingerprint(UNRELATED_SERVE.as_bytes(), &mapping.canonical()).unwrap();
        assert_ne!(empty, unrelated);
        assert_eq!(
            service_config_fingerprint(UNRELATED_SERVICE_CONFIG.as_bytes()).unwrap(),
            service_config_fingerprint(
                serde_json::to_string(
                    &serde_json::from_str::<Value>(UNRELATED_SERVICE_CONFIG).unwrap()
                )
                .unwrap()
                .as_bytes()
            )
            .unwrap()
        );
    }

    #[test]
    fn state_missing_valid_unknown_malformed_and_stale_are_non_destructive() {
        let root = test_directory("state-load");
        let path = state_path(&root);
        assert_eq!(load_state(&path), Ok(StateLoad::Missing));

        let valid = TailscaleAccessConfig::enabled(&ManagedMapping::new(18108).unwrap());
        save_state_atomic(&path, &valid).unwrap();
        assert_eq!(load_state(&path), Ok(StateLoad::Loaded(valid.clone())));

        let mut value = serde_json::to_value(&valid).unwrap();
        value["schemaVersion"] = Value::from(99);
        fs::write(&path, serde_json::to_vec(&value).unwrap()).unwrap();
        assert_eq!(load_state(&path), Err(StateErrorCode::UnknownVersion));

        fs::write(&path, b"{not-json").unwrap();
        assert_eq!(load_state(&path), Err(StateErrorCode::Malformed));

        let mut stale = valid;
        stale.managed_target = Some("http://127.0.0.1:19000".to_string());
        fs::write(&path, serde_json::to_vec(&stale).unwrap()).unwrap();
        assert_eq!(load_state(&path), Err(StateErrorCode::StaleOwnership));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn state_writes_replace_atomically_use_restrictive_permissions_and_hold_no_secrets() {
        let root = test_directory("state-save");
        let path = state_path(&root);
        let enabled = TailscaleAccessConfig::enabled(&ManagedMapping::new(18108).unwrap());
        save_state_atomic(&path, &enabled).unwrap();
        save_state_atomic(&path, &TailscaleAccessConfig::disabled()).unwrap();

        let raw = fs::read_to_string(&path).unwrap();
        assert!(raw.ends_with('\n'));
        for prohibited in [
            "transportToken",
            "authKey",
            "tailnetDnsName",
            "accessUrl",
            "identity",
            "memory",
        ] {
            assert!(!raw.contains(prohibited));
        }
        assert!(!fs::read_dir(&root).unwrap().any(|entry| entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .ends_with(".tmp")));
        #[cfg(unix)]
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn state_persistence_failure_is_reported_and_temp_file_is_cleaned_up() {
        let root = test_directory("state-failure");
        let not_directory = root.join("not-directory");
        fs::write(&not_directory, b"file").unwrap();
        let path = not_directory.join("tailscale-access.json");
        assert_eq!(
            save_state_atomic(&path, &TailscaleAccessConfig::disabled()),
            Err(StateErrorCode::Io)
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn bounded_reader_drains_input_and_reports_truncation() {
        let captured = read_capped(Cursor::new(vec![b'x'; 32]), 8).unwrap();
        assert_eq!(captured.bytes.len(), 8);
        assert!(captured.exceeded);
    }

    #[test]
    fn fake_runner_classifies_timeout_nonzero_and_ambiguous_mutations() {
        let executable = ResolvedExecutable(PathBuf::from("tailscale"));
        let limits = RunLimits::default();
        let timeout = FakeRunner::new(Err(RunnerError::Timeout));
        assert_eq!(
            execute_allowlisted(&timeout, &executable, &TailscaleCommand::StatusJson, limits),
            CommandOutcome::Failed {
                error_code: TailscaleErrorCode::CommandTimeout,
                exit_category: CommandExitCategory::Timeout
            }
        );

        let nonzero = FakeRunner::new(Ok(CapturedOutput {
            exit_code: Some(1),
            stdout: Vec::new(),
            stderr: b"canary-sensitive-output".to_vec(),
        }));
        assert_eq!(
            execute_allowlisted(&nonzero, &executable, &TailscaleCommand::Version, limits),
            CommandOutcome::Failed {
                error_code: TailscaleErrorCode::CommandFailed,
                exit_category: CommandExitCategory::NonZero
            }
        );
        assert_eq!(
            execute_allowlisted(
                &timeout,
                &executable,
                &TailscaleCommand::Enable(ManagedMapping::new(18108).unwrap()),
                limits
            ),
            CommandOutcome::Ambiguous {
                error_code: TailscaleErrorCode::AmbiguousOutcome,
                exit_category: CommandExitCategory::Ambiguous
            }
        );
        assert_eq!(timeout.calls(), 2);
        assert_eq!(nonzero.calls(), 1);
    }

    #[test]
    fn structured_diagnostics_and_external_detail_redaction_leak_no_canaries() {
        let mut event =
            DiagnosticEvent::new("alice@example.com?token=canary", DiagnosticAction::Enable);
        event.readiness = Some(TailscaleReadinessState::ConsentRequired);
        event.ownership = Some(ServeOwnership::Ambiguous);
        event.command_kind = Some(TailscaleCommandKind::Enable);
        event.exit_category = Some(CommandExitCategory::Ambiguous);
        event.error_code = Some(TailscaleErrorCode::AmbiguousOutcome);
        let line = event.to_json_line();
        assert!(!line.contains("alice@example.com"));
        assert!(!line.contains("canary"));
        assert!(!line.contains("mappingFingerprint"));

        let detail = "login alice@example.com token=canary tskey-auth-secret \
                      https://login.tailscale.com/path?token=secret \
                      aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        let redacted = sanitize_external_detail(detail);
        assert_eq!(redacted, "external detail redacted");
        assert!(!redacted.contains("alice"));
        assert!(!redacted.contains("secret"));
    }

    fn strings(args: Vec<OsString>) -> Vec<String> {
        args.into_iter()
            .map(|argument| argument.into_string().unwrap())
            .collect()
    }

    fn test_directory(label: &str) -> PathBuf {
        let path = env::temp_dir().join(format!(
            "braindrive-tailscale-{label}-{}-{}",
            std::process::id(),
            TEMP_FILE_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    struct FakeRunner {
        outcomes: std::sync::Mutex<VecDeque<Result<CapturedOutput, RunnerError>>>,
        call_count: AtomicU64,
    }

    impl FakeRunner {
        fn new(outcome: Result<CapturedOutput, RunnerError>) -> Self {
            Self {
                outcomes: std::sync::Mutex::new(VecDeque::from([outcome.clone(), outcome])),
                call_count: AtomicU64::new(0),
            }
        }

        fn calls(&self) -> u64 {
            self.call_count.load(Ordering::Relaxed)
        }
    }

    impl TailscaleRunner for FakeRunner {
        fn run(
            &self,
            _executable: &ResolvedExecutable,
            _command: &TailscaleCommand,
            _limits: RunLimits,
        ) -> Result<CapturedOutput, RunnerError> {
            self.call_count.fetch_add(1, Ordering::Relaxed);
            self.outcomes.lock().unwrap().pop_front().unwrap()
        }
    }
}
