use crate::tailscale_access::{
    access_url_from_dns_name, classify_ownership, classify_status, parse_consent_url,
    parse_serve_status_json, parse_service_config_json, parse_status_json,
    readiness_from_runner_error, service_config_fingerprint, unrelated_serve_fingerprint,
    CapturedOutput, CommandExitCategory, DiagnosticAction, DiagnosticEvent, ManagedMapping,
    RunLimits, RunnerError, SemanticVersion, ServeConfigView, ServeOwnership, StateErrorCode,
    StateLoad, TailnetBridgeState, TailscaleAccessAction, TailscaleAccessConfig,
    TailscaleAccessState, TailscaleAccessStatus, TailscaleCommand, TailscaleCommandKind,
    TailscaleErrorCode, TailscaleReadiness, TailscaleReadinessState, MINIMUM_SUPPORTED_VERSION,
};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DeploymentMode {
    Local,
    Managed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LifecycleAction {
    Status,
    Enable,
    Retry,
    Disable,
    Startup,
}

pub trait TailscaleRuntimeBackend {
    fn deployment_mode(&self) -> DeploymentMode;
    fn owner_initialized(&mut self) -> Result<bool, TailscaleErrorCode>;
    fn load_state(&mut self) -> Result<StateLoad, StateErrorCode>;
    fn save_state(&mut self, state: &TailscaleAccessConfig) -> Result<(), StateErrorCode>;
    fn run_command(
        &mut self,
        command: &TailscaleCommand,
        limits: RunLimits,
    ) -> Result<CapturedOutput, RunnerError>;
    fn bridge_healthy(&mut self, port: u16) -> bool;
    fn start_bridge(&mut self, preferred_port: Option<u16>) -> Result<u16, TailscaleErrorCode>;
    fn stop_bridge(&mut self);
    fn record_diagnostic(&mut self, event: &DiagnosticEvent);
    fn mutation_evidence(&self) -> Option<(TailscaleCommandKind, CommandExitCategory)> {
        None
    }
}

struct Inspection {
    readiness: TailscaleReadiness,
    serve: ServeConfigView,
    serve_raw: Vec<u8>,
    service_raw: Vec<u8>,
    access_url: Option<String>,
}

struct InspectionFailure {
    readiness: TailscaleReadiness,
    error_code: TailscaleErrorCode,
}

pub fn perform<B: TailscaleRuntimeBackend>(
    backend: &mut B,
    action: LifecycleAction,
    operation_id: &str,
) -> TailscaleAccessStatus {
    let state_load = backend.load_state();
    let prior = cached_state(&state_load);
    let mut event = DiagnosticEvent::new(operation_id, diagnostic_action(action));
    event.prior_state = Some(prior);

    let status = if backend.deployment_mode() != DeploymentMode::Local {
        unavailable_status(
            false,
            TailscaleErrorCode::IneligibleDeployment,
            "Tailscale access is available only in local BrainDrive Desktop.",
        )
    } else {
        match action {
            LifecycleAction::Status => status(backend, state_load),
            LifecycleAction::Enable | LifecycleAction::Retry => {
                enable(backend, state_load, action == LifecycleAction::Retry)
            }
            LifecycleAction::Disable => disable(backend, state_load),
            LifecycleAction::Startup => startup(backend, state_load),
        }
    };

    event.desired_enabled = Some(status.desired_enabled);
    event.readiness = Some(status.readiness.state);
    event.ownership = Some(status.ownership);
    event.post_state = Some(status.state);
    event.error_code = status.error_code;
    if let Some((command_kind, exit_category)) = backend.mutation_evidence() {
        event.command_kind = Some(command_kind);
        event.exit_category = Some(exit_category);
        event.external_change = Some(match action {
            LifecycleAction::Enable | LifecycleAction::Retry | LifecycleAction::Startup => {
                status.state == TailscaleAccessState::Running
                    || status.bridge_state == TailnetBridgeState::Running
            }
            LifecycleAction::Disable => {
                status.state == TailscaleAccessState::Off
                    || status.ownership == ServeOwnership::Absent
            }
            LifecycleAction::Status => false,
        });
    }
    event.decision = Some(decision_for(&status).to_string());
    event.corrective_action = status.detail.clone();
    backend.record_diagnostic(&event);
    status
}

pub fn not_started_status() -> TailscaleAccessStatus {
    unavailable_status(
        false,
        TailscaleErrorCode::Internal,
        "The BrainDrive desktop runtime has not started yet.",
    )
}

pub fn shutdown<B: TailscaleRuntimeBackend>(backend: &mut B, operation_id: &str) {
    backend.stop_bridge();
    let mut event = DiagnosticEvent::new(operation_id, DiagnosticAction::Shutdown);
    event.external_change = Some(false);
    event.decision = Some("tailnet_bridge_stopped_mapping_preserved".to_string());
    backend.record_diagnostic(&event);
}

fn status<B: TailscaleRuntimeBackend>(
    backend: &mut B,
    state_load: Result<StateLoad, StateErrorCode>,
) -> TailscaleAccessStatus {
    let state = match state_load {
        Ok(StateLoad::Missing) => None,
        Ok(StateLoad::Loaded(state)) => Some(state),
        Err(error) => return state_error_status(error),
    };
    let desired = state.as_ref().is_some_and(|state| state.desired_enabled);
    let inspection = match inspect(backend) {
        Ok(inspection) => inspection,
        Err(failure) => return inspection_failure_status(desired, failure),
    };
    let expected = state
        .as_ref()
        .and_then(|state| state.mapping_fingerprint.as_deref());
    let ownership = effective_ownership(&inspection, expected);

    if desired {
        if ownership == ServeOwnership::OwnedExact {
            let bridge_running = state
                .as_ref()
                .and_then(TailscaleAccessConfig::managed_mapping)
                .is_some_and(|mapping| backend.bridge_healthy(mapping.loopback_port()));
            if bridge_running {
                return running_status(state.as_ref().unwrap(), inspection);
            }
            return attention_status(
                true,
                inspection.readiness,
                ownership,
                TailnetBridgeState::Failed,
                Some(TailscaleErrorCode::BridgeUnavailable),
                "Private access is configured, but its local bridge is unavailable.",
                "Retry to restart the private bridge.",
            );
        }
        return conflict_or_attention(true, inspection.readiness, ownership);
    }

    if ownership != ServeOwnership::Absent {
        return conflict_or_attention(false, inspection.readiness, ownership);
    }
    let state_code = if state.is_none() {
        TailscaleAccessState::Ready
    } else {
        TailscaleAccessState::Off
    };
    base_status(
        state_code,
        false,
        inspection.readiness,
        ServeOwnership::Absent,
        TailnetBridgeState::Stopped,
        None,
        None,
        vec![
            TailscaleAccessAction::Enable,
            TailscaleAccessAction::CheckAgain,
        ],
        "Tailscale is ready for private BrainDrive access.",
        None,
        None,
    )
}

fn enable<B: TailscaleRuntimeBackend>(
    backend: &mut B,
    state_load: Result<StateLoad, StateErrorCode>,
    _retry: bool,
) -> TailscaleAccessStatus {
    if !owner_is_initialized(backend) {
        return unavailable_status(
            false,
            TailscaleErrorCode::OwnerNotInitialized,
            "Create the local BrainDrive owner account before enabling private access.",
        );
    }
    let state = match state_load {
        Ok(StateLoad::Missing) => None,
        Ok(StateLoad::Loaded(state)) => Some(state),
        Err(error) => return state_error_status(error),
    };
    let desired = state.as_ref().is_some_and(|state| state.desired_enabled);
    let before = match inspect(backend) {
        Ok(inspection) => inspection,
        Err(failure) => return inspection_failure_status(desired, failure),
    };
    let expected = state
        .as_ref()
        .and_then(|state| state.mapping_fingerprint.as_deref());
    let ownership = effective_ownership(&before, expected);

    if ownership == ServeOwnership::OwnedExact {
        let mapping = state
            .as_ref()
            .and_then(TailscaleAccessConfig::managed_mapping);
        let Some(mapping) = mapping else {
            return state_error_status(StateErrorCode::StaleOwnership);
        };
        if let Err(code) = ensure_bridge(backend, Some(mapping.loopback_port())) {
            return bridge_error_status(true, before.readiness, ownership, code);
        }
        return running_status(state.as_ref().unwrap(), before);
    }
    if !matches!(
        ownership,
        ServeOwnership::Absent | ServeOwnership::OwnedDrifted
    ) || before.serve.selected_mapping.is_some()
        || before.serve.selected_conflict
        || before.serve.funnel_present
    {
        return conflict_or_attention(desired, before.readiness, ownership);
    }
    if ownership == ServeOwnership::OwnedDrifted && before.serve.selected_mapping.is_some() {
        return conflict_or_attention(true, before.readiness, ownership);
    }

    let preferred = state
        .as_ref()
        .and_then(TailscaleAccessConfig::managed_mapping)
        .map(|mapping| mapping.loopback_port());
    let bridge_port = match ensure_bridge(backend, preferred) {
        Ok(port) => port,
        Err(code) => return bridge_error_status(desired, before.readiness, ownership, code),
    };
    let mapping = match ManagedMapping::new(bridge_port) {
        Ok(mapping) => mapping,
        Err(code) => {
            backend.stop_bridge();
            return bridge_error_status(desired, before.readiness, ownership, code);
        }
    };
    let before_serve_fingerprint =
        match unrelated_serve_fingerprint(&before.serve_raw, &mapping.canonical()) {
            Ok(fingerprint) => fingerprint,
            Err(code) => {
                backend.stop_bridge();
                return attention_status(
                    desired,
                    before.readiness,
                    ownership,
                    TailnetBridgeState::Stopped,
                    Some(code),
                    "Tailscale configuration could not be compared safely.",
                    "Check Tailscale, then retry.",
                );
            }
        };
    let before_service_fingerprint = match service_config_fingerprint(&before.service_raw) {
        Ok(fingerprint) => fingerprint,
        Err(code) => {
            backend.stop_bridge();
            return attention_status(
                desired,
                before.readiness,
                ownership,
                TailnetBridgeState::Stopped,
                Some(code),
                "Tailscale service configuration could not be compared safely.",
                "Check Tailscale, then retry.",
            );
        }
    };

    let command_result = backend.run_command(
        &TailscaleCommand::Enable(mapping.clone()),
        RunLimits::default(),
    );
    let setup_url = command_result.as_ref().ok().and_then(setup_url_from_output);
    let after = match inspect(backend) {
        Ok(inspection) => inspection,
        Err(failure) => {
            if setup_url.is_some() {
                backend.stop_bridge();
                return setup_status(failure.readiness, setup_url);
            }
            return inspection_failure_status(true, failure);
        }
    };
    let after_ownership = effective_ownership(&after, Some(&mapping.canonical().fingerprint()));
    let unchanged = preservation_matches(
        &before_serve_fingerprint,
        &before_service_fingerprint,
        &after,
        &mapping,
    );
    if after_ownership != ServeOwnership::OwnedExact || !unchanged {
        if let Some(url) = setup_url {
            backend.stop_bridge();
            return setup_status(after.readiness, Some(url));
        }
        if command_result.is_err()
            || !unchanged
            || (after_ownership == ServeOwnership::OwnedDrifted
                && after.serve.selected_mapping.is_none())
        {
            let (error_code, message, detail) = enable_failure_feedback(&command_result);
            let reported_ownership = if desired {
                after_ownership
            } else if after.serve.selected_mapping.is_some() {
                ServeOwnership::Ambiguous
            } else {
                ServeOwnership::Absent
            };
            let bridge_state = if after_ownership == ServeOwnership::OwnedExact {
                TailnetBridgeState::Running
            } else {
                backend.stop_bridge();
                TailnetBridgeState::Stopped
            };
            return attention_status(
                desired,
                after.readiness,
                reported_ownership,
                bridge_state,
                Some(error_code),
                message,
                detail,
            );
        }
        return conflict_or_attention(desired, after.readiness, after_ownership);
    }

    let saved = TailscaleAccessConfig::enabled(&mapping);
    if backend.save_state(&saved).is_err() {
        let ownership = if desired {
            ServeOwnership::OwnedExact
        } else {
            ServeOwnership::Ambiguous
        };
        return attention_status(
            desired,
            after.readiness,
            ownership,
            TailnetBridgeState::Running,
            Some(TailscaleErrorCode::Persistence),
            "Private access is live, but BrainDrive could not save its ownership record.",
            "Do not change the mapping; retry after checking desktop storage.",
        );
    }
    running_status(&saved, after)
}

fn disable<B: TailscaleRuntimeBackend>(
    backend: &mut B,
    state_load: Result<StateLoad, StateErrorCode>,
) -> TailscaleAccessStatus {
    let state = match state_load {
        Ok(StateLoad::Missing) => None,
        Ok(StateLoad::Loaded(state)) => Some(state),
        Err(error) => return state_error_status(error),
    };
    let desired = state.as_ref().is_some_and(|state| state.desired_enabled);
    let before = match inspect(backend) {
        Ok(inspection) => inspection,
        Err(failure) => return inspection_failure_status(desired, failure),
    };
    let expected = state
        .as_ref()
        .and_then(|state| state.mapping_fingerprint.as_deref());
    let ownership = effective_ownership(&before, expected);

    if ownership == ServeOwnership::Absent
        || (desired
            && ownership == ServeOwnership::OwnedDrifted
            && before.serve.selected_mapping.is_none()
            && !before.serve.selected_conflict
            && !before.serve.funnel_present)
    {
        if backend
            .save_state(&TailscaleAccessConfig::disabled())
            .is_err()
        {
            return persistence_status(false, before.readiness, ownership);
        }
        backend.stop_bridge();
        return off_status(before.readiness);
    }
    if !desired || ownership != ServeOwnership::OwnedExact {
        return conflict_or_attention(desired, before.readiness, ownership);
    }
    let mapping = state
        .as_ref()
        .and_then(TailscaleAccessConfig::managed_mapping)
        .expect("validated enabled state has a managed mapping");
    let before_serve = match unrelated_serve_fingerprint(&before.serve_raw, &mapping.canonical()) {
        Ok(value) => value,
        Err(code) => return comparison_failure(true, before.readiness, ownership, code),
    };
    let before_service = match service_config_fingerprint(&before.service_raw) {
        Ok(value) => value,
        Err(code) => return comparison_failure(true, before.readiness, ownership, code),
    };

    let _command_result = backend.run_command(&TailscaleCommand::Disable, RunLimits::default());
    let after = match inspect(backend) {
        Ok(inspection) => inspection,
        Err(failure) => return inspection_failure_status(true, failure),
    };
    let after_ownership = effective_ownership(&after, Some(&mapping.canonical().fingerprint()));
    let unchanged = preservation_matches(&before_serve, &before_service, &after, &mapping);
    if after.serve.selected_mapping.is_some()
        || after.serve.selected_conflict
        || !matches!(after_ownership, ServeOwnership::OwnedDrifted)
        || !unchanged
    {
        return attention_status(
            true,
            after.readiness,
            after_ownership,
            TailnetBridgeState::Running,
            Some(TailscaleErrorCode::AmbiguousOutcome),
            "BrainDrive could not verify that private access was removed safely.",
            "Inspect Tailscale before trying again.",
        );
    }
    if backend
        .save_state(&TailscaleAccessConfig::disabled())
        .is_err()
    {
        backend.stop_bridge();
        return persistence_status(false, after.readiness, ServeOwnership::Absent);
    }
    backend.stop_bridge();
    off_status(after.readiness)
}

fn startup<B: TailscaleRuntimeBackend>(
    backend: &mut B,
    state_load: Result<StateLoad, StateErrorCode>,
) -> TailscaleAccessStatus {
    let state = match state_load {
        Ok(StateLoad::Missing) => {
            backend.stop_bridge();
            return off_status(default_readiness());
        }
        Ok(StateLoad::Loaded(state)) => state,
        Err(error) => return state_error_status(error),
    };
    if !state.desired_enabled {
        backend.stop_bridge();
        return off_status(default_readiness());
    }
    if !owner_is_initialized(backend) {
        return unavailable_status(
            true,
            TailscaleErrorCode::OwnerNotInitialized,
            "Private access is saved but the local owner account is unavailable.",
        );
    }
    enable(backend, Ok(StateLoad::Loaded(state)), true)
}

fn inspect<B: TailscaleRuntimeBackend>(backend: &mut B) -> Result<Inspection, InspectionFailure> {
    let version_output = run_read(backend, &TailscaleCommand::Version)?;
    let version = SemanticVersion::parse(&String::from_utf8_lossy(&version_output.stdout))
        .map_err(|code| InspectionFailure {
            readiness: readiness_error(code),
            error_code: code,
        })?;
    if !version.is_supported() {
        let mut readiness = readiness_error(TailscaleErrorCode::UnsupportedVersion);
        readiness.state = TailscaleReadinessState::UnsupportedVersion;
        readiness.installed_version = Some(version);
        return Err(InspectionFailure {
            readiness,
            error_code: TailscaleErrorCode::UnsupportedVersion,
        });
    }
    let status_output = run_read(backend, &TailscaleCommand::StatusJson)?;
    let snapshot = parse_status_json(&status_output.stdout).map_err(|code| InspectionFailure {
        readiness: readiness_error(code),
        error_code: code,
    })?;
    let readiness = classify_status(&snapshot);
    if readiness.state != TailscaleReadinessState::Ready {
        return Err(InspectionFailure {
            error_code: readiness.error_code.unwrap_or(TailscaleErrorCode::Internal),
            readiness,
        });
    }
    let access_url = access_url_from_dns_name(snapshot.dns_name.as_deref());
    if access_url.is_none() {
        return Err(InspectionFailure {
            readiness: readiness_error(TailscaleErrorCode::MissingDns),
            error_code: TailscaleErrorCode::MissingDns,
        });
    }
    let serve_output = run_read(backend, &TailscaleCommand::ServeStatusJson)?;
    let serve =
        parse_serve_status_json(&serve_output.stdout).map_err(|code| InspectionFailure {
            readiness: readiness.clone(),
            error_code: code,
        })?;
    let service_output = run_read(backend, &TailscaleCommand::ServeGetConfigAll)?;
    let service =
        parse_service_config_json(&service_output.stdout).map_err(|code| InspectionFailure {
            readiness: readiness.clone(),
            error_code: code,
        })?;
    let mut serve = serve;
    if service.managed_port_in_use {
        serve.selected_conflict = true;
    }
    Ok(Inspection {
        readiness,
        serve,
        serve_raw: serve_output.stdout,
        service_raw: service_output.stdout,
        access_url,
    })
}

fn run_read<B: TailscaleRuntimeBackend>(
    backend: &mut B,
    command: &TailscaleCommand,
) -> Result<CapturedOutput, InspectionFailure> {
    match backend.run_command(command, RunLimits::default()) {
        Ok(output) if output.exit_code == Some(0) => Ok(output),
        Ok(_) => Err(InspectionFailure {
            readiness: readiness_error(TailscaleErrorCode::CommandFailed),
            error_code: TailscaleErrorCode::CommandFailed,
        }),
        Err(error) => {
            let readiness = readiness_from_runner_error(error);
            Err(InspectionFailure {
                error_code: readiness.error_code.unwrap_or(TailscaleErrorCode::Internal),
                readiness,
            })
        }
    }
}

fn owner_is_initialized<B: TailscaleRuntimeBackend>(backend: &mut B) -> bool {
    backend.owner_initialized().unwrap_or(false)
}

fn ensure_bridge<B: TailscaleRuntimeBackend>(
    backend: &mut B,
    preferred: Option<u16>,
) -> Result<u16, TailscaleErrorCode> {
    if let Some(port) = preferred {
        if backend.bridge_healthy(port) {
            return Ok(port);
        }
    }
    let port = backend.start_bridge(preferred)?;
    if backend.bridge_healthy(port) {
        Ok(port)
    } else {
        backend.stop_bridge();
        Err(TailscaleErrorCode::BridgeUnavailable)
    }
}

fn effective_ownership(inspection: &Inspection, expected: Option<&str>) -> ServeOwnership {
    if inspection.serve.funnel_present {
        ServeOwnership::Ambiguous
    } else {
        classify_ownership(&inspection.serve, expected)
    }
}

fn preservation_matches(
    before_serve: &str,
    before_service: &str,
    after: &Inspection,
    mapping: &ManagedMapping,
) -> bool {
    unrelated_serve_fingerprint(&after.serve_raw, &mapping.canonical())
        .is_ok_and(|value| value == before_serve)
        && service_config_fingerprint(&after.service_raw).is_ok_and(|value| value == before_service)
}

fn setup_url_from_output(output: &CapturedOutput) -> Option<String> {
    [&output.stdout, &output.stderr]
        .into_iter()
        .find_map(|bytes| {
            parse_consent_url(&String::from_utf8_lossy(bytes))
                .ok()
                .flatten()
                .map(|url| url.as_str().to_string())
        })
}

fn enable_failure_feedback(
    command_result: &Result<CapturedOutput, RunnerError>,
) -> (TailscaleErrorCode, &'static str, &'static str) {
    match command_result {
        Err(RunnerError::Timeout) => (
            TailscaleErrorCode::CommandTimeout,
            "Tailscale HTTPS Serve setup did not finish.",
            "Open Tailscale admin DNS settings and enable HTTPS Certificates, or approve the Serve setup prompt, then retry. No private access mapping was verified.",
        ),
        Err(RunnerError::OutputTooLarge) => (
            TailscaleErrorCode::OutputTooLarge,
            "Tailscale returned too much output while enabling private access.",
            "Check Tailscale, then retry.",
        ),
        Err(RunnerError::ExecutableMissing) => (
            TailscaleErrorCode::NotInstalled,
            "Tailscale could not be found while enabling private access.",
            "Open or reinstall Tailscale, then retry.",
        ),
        Err(RunnerError::PermissionDenied) => (
            TailscaleErrorCode::PermissionDenied,
            "BrainDrive could not run Tailscale with the required permissions.",
            "Check Tailscale permissions, then retry.",
        ),
        Err(RunnerError::Io) => (
            TailscaleErrorCode::DaemonUnavailable,
            "Tailscale was unavailable while enabling private access.",
            "Open or restart Tailscale, then retry.",
        ),
        Ok(output) if output.exit_code != Some(0) => (
            TailscaleErrorCode::CommandFailed,
            "Tailscale did not enable private access.",
            "Check Tailscale, then retry.",
        ),
        _ => (
            TailscaleErrorCode::AmbiguousOutcome,
            "Private access could not be verified safely.",
            "Check Tailscale configuration before retrying.",
        ),
    }
}

fn running_status(state: &TailscaleAccessConfig, inspection: Inspection) -> TailscaleAccessStatus {
    base_status(
        TailscaleAccessState::Running,
        true,
        inspection.readiness,
        ServeOwnership::OwnedExact,
        TailnetBridgeState::Running,
        inspection.access_url,
        None,
        vec![
            TailscaleAccessAction::CheckAgain,
            TailscaleAccessAction::Disable,
        ],
        "Private Tailscale access is running.",
        Some("BrainDrive sign-in is still required on other trusted devices."),
        None,
    )
    .with_desired(state.desired_enabled)
}

fn off_status(readiness: TailscaleReadiness) -> TailscaleAccessStatus {
    base_status(
        TailscaleAccessState::Off,
        false,
        readiness,
        ServeOwnership::Absent,
        TailnetBridgeState::Stopped,
        None,
        None,
        vec![
            TailscaleAccessAction::Enable,
            TailscaleAccessAction::CheckAgain,
        ],
        "Private Tailscale access is off.",
        None,
        None,
    )
}

fn setup_status(
    mut readiness: TailscaleReadiness,
    setup_url: Option<String>,
) -> TailscaleAccessStatus {
    readiness.state = TailscaleReadinessState::ConsentRequired;
    readiness.error_code = Some(TailscaleErrorCode::ConsentRequired);
    base_status(
        TailscaleAccessState::NeedsSetup,
        false,
        readiness,
        ServeOwnership::Absent,
        TailnetBridgeState::Stopped,
        None,
        setup_url,
        vec![
            TailscaleAccessAction::CompleteSetup,
            TailscaleAccessAction::Retry,
        ],
        "Tailscale needs setup before BrainDrive can enable private access.",
        Some("Complete Tailscale setup, then retry."),
        Some(TailscaleErrorCode::ConsentRequired),
    )
}

fn unavailable_status(
    desired: bool,
    code: TailscaleErrorCode,
    message: &str,
) -> TailscaleAccessStatus {
    attention_status(
        desired,
        readiness_error(code),
        ServeOwnership::Absent,
        TailnetBridgeState::Stopped,
        Some(code),
        message,
        "No external network change was made.",
    )
}

fn inspection_failure_status(desired: bool, failure: InspectionFailure) -> TailscaleAccessStatus {
    let state = if matches!(
        failure.readiness.state,
        TailscaleReadinessState::Missing
            | TailscaleReadinessState::SignedOut
            | TailscaleReadinessState::Offline
            | TailscaleReadinessState::MissingDns
            | TailscaleReadinessState::UnsupportedVersion
            | TailscaleReadinessState::ConsentRequired
    ) {
        TailscaleAccessState::NeedsSetup
    } else {
        TailscaleAccessState::NeedsAttention
    };
    base_status(
        state,
        desired,
        failure.readiness,
        ServeOwnership::Absent,
        TailnetBridgeState::Stopped,
        None,
        None,
        recovery_actions(desired),
        "Tailscale access is not ready.",
        Some("Check the Tailscale app, then retry."),
        Some(failure.error_code),
    )
}

fn state_error_status(error: StateErrorCode) -> TailscaleAccessStatus {
    let code = match error {
        StateErrorCode::StaleOwnership => TailscaleErrorCode::StaleOwnership,
        _ => TailscaleErrorCode::Persistence,
    };
    attention_status(
        false,
        default_readiness(),
        ServeOwnership::Ambiguous,
        TailnetBridgeState::Stopped,
        Some(code),
        "BrainDrive cannot verify its saved Tailscale ownership state.",
        "Do not remove any mapping automatically; inspect the saved state and Tailscale configuration.",
    )
}

fn bridge_error_status(
    desired: bool,
    readiness: TailscaleReadiness,
    ownership: ServeOwnership,
    code: TailscaleErrorCode,
) -> TailscaleAccessStatus {
    attention_status(
        desired,
        readiness,
        ownership,
        TailnetBridgeState::Failed,
        Some(code),
        "The private loopback bridge could not start.",
        "Local BrainDrive and Browser Access remain available; retry after checking desktop logs.",
    )
}

fn comparison_failure(
    desired: bool,
    readiness: TailscaleReadiness,
    ownership: ServeOwnership,
    code: TailscaleErrorCode,
) -> TailscaleAccessStatus {
    attention_status(
        desired,
        readiness,
        ownership,
        TailnetBridgeState::Running,
        Some(code),
        "Tailscale configuration could not be compared safely.",
        "No mapping was changed.",
    )
}

fn persistence_status(
    desired: bool,
    readiness: TailscaleReadiness,
    ownership: ServeOwnership,
) -> TailscaleAccessStatus {
    attention_status(
        desired,
        readiness,
        ownership,
        TailnetBridgeState::Stopped,
        Some(TailscaleErrorCode::Persistence),
        "The external state was verified, but BrainDrive could not save local state.",
        "Check desktop storage before retrying.",
    )
}

fn conflict_or_attention(
    desired: bool,
    readiness: TailscaleReadiness,
    ownership: ServeOwnership,
) -> TailscaleAccessStatus {
    let state = if matches!(
        ownership,
        ServeOwnership::OccupiedUnowned | ServeOwnership::OwnedDrifted
    ) {
        TailscaleAccessState::Conflict
    } else {
        TailscaleAccessState::NeedsAttention
    };
    base_status(
        state,
        desired,
        readiness,
        ownership,
        TailnetBridgeState::Stopped,
        None,
        None,
        recovery_actions(desired),
        "Tailscale configuration conflicts with BrainDrive private access.",
        Some("BrainDrive did not change the existing Tailscale configuration."),
        Some(TailscaleErrorCode::Conflict),
    )
}

fn attention_status(
    desired: bool,
    readiness: TailscaleReadiness,
    ownership: ServeOwnership,
    bridge_state: TailnetBridgeState,
    error_code: Option<TailscaleErrorCode>,
    message: &str,
    detail: &str,
) -> TailscaleAccessStatus {
    base_status(
        TailscaleAccessState::NeedsAttention,
        desired,
        readiness,
        ownership,
        bridge_state,
        None,
        None,
        recovery_actions(desired),
        message,
        Some(detail),
        error_code,
    )
}

#[allow(clippy::too_many_arguments)]
fn base_status(
    state: TailscaleAccessState,
    desired_enabled: bool,
    readiness: TailscaleReadiness,
    ownership: ServeOwnership,
    bridge_state: TailnetBridgeState,
    access_url: Option<String>,
    setup_url: Option<String>,
    available_actions: Vec<TailscaleAccessAction>,
    message: &str,
    detail: Option<&str>,
    error_code: Option<TailscaleErrorCode>,
) -> TailscaleAccessStatus {
    TailscaleAccessStatus {
        state,
        desired_enabled,
        readiness,
        ownership,
        bridge_state,
        access_url,
        setup_url,
        available_actions,
        message: message.to_string(),
        detail: detail.map(str::to_string),
        error_code,
        checked_at_unix_ms: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
            .try_into()
            .unwrap_or(u64::MAX),
    }
}

trait DesiredStatus {
    fn with_desired(self, desired: bool) -> Self;
}

impl DesiredStatus for TailscaleAccessStatus {
    fn with_desired(mut self, desired: bool) -> Self {
        self.desired_enabled = desired;
        self
    }
}

fn readiness_error(code: TailscaleErrorCode) -> TailscaleReadiness {
    let state = match code {
        TailscaleErrorCode::NotInstalled => TailscaleReadinessState::Missing,
        TailscaleErrorCode::PermissionDenied => TailscaleReadinessState::PermissionDenied,
        TailscaleErrorCode::UnsupportedVersion => TailscaleReadinessState::UnsupportedVersion,
        TailscaleErrorCode::NotSignedIn => TailscaleReadinessState::SignedOut,
        TailscaleErrorCode::Offline => TailscaleReadinessState::Offline,
        TailscaleErrorCode::MissingDns => TailscaleReadinessState::MissingDns,
        TailscaleErrorCode::ConsentRequired => TailscaleReadinessState::ConsentRequired,
        _ => TailscaleReadinessState::DaemonUnavailable,
    };
    TailscaleReadiness {
        state,
        installed_version: None,
        minimum_supported_version: MINIMUM_SUPPORTED_VERSION,
        backend_state: None,
        online: None,
        dns_name_available: false,
        error_code: Some(code),
    }
}

fn recovery_actions(desired: bool) -> Vec<TailscaleAccessAction> {
    let mut actions = vec![
        TailscaleAccessAction::Retry,
        TailscaleAccessAction::CheckAgain,
    ];
    if desired {
        actions.push(TailscaleAccessAction::Disable);
    }
    actions
}

fn default_readiness() -> TailscaleReadiness {
    readiness_error(TailscaleErrorCode::NotInstalled)
}

fn cached_state(state: &Result<StateLoad, StateErrorCode>) -> TailscaleAccessState {
    match state {
        Ok(StateLoad::Loaded(config)) if config.desired_enabled => TailscaleAccessState::Starting,
        Ok(_) => TailscaleAccessState::Off,
        Err(_) => TailscaleAccessState::NeedsAttention,
    }
}

fn diagnostic_action(action: LifecycleAction) -> DiagnosticAction {
    match action {
        LifecycleAction::Status => DiagnosticAction::Inspect,
        LifecycleAction::Enable => DiagnosticAction::Enable,
        LifecycleAction::Retry => DiagnosticAction::Retry,
        LifecycleAction::Disable => DiagnosticAction::Disable,
        LifecycleAction::Startup => DiagnosticAction::Startup,
    }
}

fn decision_for(status: &TailscaleAccessStatus) -> &'static str {
    match status.state {
        TailscaleAccessState::Off => "off_verified",
        TailscaleAccessState::NeedsSetup => "setup_required",
        TailscaleAccessState::Ready => "ready_to_enable",
        TailscaleAccessState::Starting => "operation_in_progress",
        TailscaleAccessState::Running => "running_verified",
        TailscaleAccessState::Conflict => "mutation_rejected_conflict",
        TailscaleAccessState::NeedsAttention => "manual_attention_required",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tailscale_access::{MANAGED_LOOPBACK_PORT_START, STATE_SCHEMA_VERSION};
    use std::sync::{Arc, Barrier, Mutex};
    use std::thread;

    #[derive(Clone, Copy)]
    enum LiveServe {
        Absent,
        Exact(u16),
        Unowned,
    }

    struct FakeBackend {
        deployment: DeploymentMode,
        owner: bool,
        state: Result<StateLoad, StateErrorCode>,
        live: LiveServe,
        calls: Vec<TailscaleCommandKind>,
        bridge_port: Option<u16>,
        bridge_health: bool,
        start_error: Option<TailscaleErrorCode>,
        persistence_fails: bool,
        mutate_on_enable: bool,
        mutate_on_disable: bool,
        enable_error: Option<RunnerError>,
        disable_error: Option<RunnerError>,
        change_unrelated_on_enable: bool,
        unrelated_changed: bool,
        consent: bool,
        browser_access_sentinel: String,
        diagnostics: Vec<DiagnosticEvent>,
    }

    impl Default for FakeBackend {
        fn default() -> Self {
            Self {
                deployment: DeploymentMode::Local,
                owner: true,
                state: Ok(StateLoad::Missing),
                live: LiveServe::Absent,
                calls: Vec::new(),
                bridge_port: None,
                bridge_health: true,
                start_error: None,
                persistence_fails: false,
                mutate_on_enable: true,
                mutate_on_disable: true,
                enable_error: None,
                disable_error: None,
                change_unrelated_on_enable: false,
                unrelated_changed: false,
                consent: false,
                browser_access_sentinel: "browser-access-running".to_string(),
                diagnostics: Vec::new(),
            }
        }
    }

    impl TailscaleRuntimeBackend for FakeBackend {
        fn deployment_mode(&self) -> DeploymentMode {
            self.deployment
        }

        fn owner_initialized(&mut self) -> Result<bool, TailscaleErrorCode> {
            Ok(self.owner)
        }

        fn load_state(&mut self) -> Result<StateLoad, StateErrorCode> {
            self.state.clone()
        }

        fn save_state(&mut self, state: &TailscaleAccessConfig) -> Result<(), StateErrorCode> {
            if self.persistence_fails {
                return Err(StateErrorCode::Io);
            }
            self.state = Ok(StateLoad::Loaded(state.clone()));
            Ok(())
        }

        fn run_command(
            &mut self,
            command: &TailscaleCommand,
            _limits: RunLimits,
        ) -> Result<CapturedOutput, RunnerError> {
            self.calls.push(command.kind());
            let output = match command {
                TailscaleCommand::Version => success(b"1.98.8\n"),
                TailscaleCommand::StatusJson => success(READY_STATUS.as_bytes()),
                TailscaleCommand::ServeStatusJson => success(self.serve_json().as_bytes()),
                TailscaleCommand::ServeGetConfigAll => success(if self.unrelated_changed {
                    CHANGED_SERVICE_CONFIG.as_bytes()
                } else {
                    SERVICE_CONFIG.as_bytes()
                }),
                TailscaleCommand::Enable(mapping) => {
                    if self.consent {
                        CapturedOutput {
                            exit_code: Some(1),
                            stdout: Vec::new(),
                            stderr:
                                b"Visit https://login.tailscale.com/admin/serve?token=secret-canary"
                                    .to_vec(),
                        }
                    } else {
                        if self.mutate_on_enable {
                            self.live = LiveServe::Exact(mapping.loopback_port());
                        }
                        if self.change_unrelated_on_enable {
                            self.unrelated_changed = true;
                        }
                        if let Some(error) = self.enable_error {
                            return Err(error);
                        }
                        success(b"")
                    }
                }
                TailscaleCommand::Disable => {
                    if self.mutate_on_disable {
                        self.live = LiveServe::Absent;
                    }
                    if let Some(error) = self.disable_error {
                        return Err(error);
                    }
                    success(b"")
                }
            };
            Ok(output)
        }

        fn bridge_healthy(&mut self, port: u16) -> bool {
            self.bridge_health && self.bridge_port == Some(port)
        }

        fn start_bridge(&mut self, preferred_port: Option<u16>) -> Result<u16, TailscaleErrorCode> {
            if let Some(error) = self.start_error {
                return Err(error);
            }
            let port = preferred_port.unwrap_or(MANAGED_LOOPBACK_PORT_START);
            self.bridge_port = Some(port);
            Ok(port)
        }

        fn stop_bridge(&mut self) {
            self.bridge_port = None;
        }

        fn record_diagnostic(&mut self, event: &DiagnosticEvent) {
            self.diagnostics.push(event.clone());
        }
    }

    impl FakeBackend {
        fn serve_json(&self) -> String {
            match self.live {
                LiveServe::Absent => "{}".to_string(),
                LiveServe::Exact(port) => format!(
                    r#"{{"TCP":{{"443":{{"HTTPS":true}}}},"Web":{{"brain-host.example-tailnet.ts.net:443":{{"Handlers":{{"/":{{"Proxy":"http://127.0.0.1:{port}"}}}}}}}}}}"#
                ),
                LiveServe::Unowned => r#"{"TCP":{"443":{"HTTPS":true}},"Web":{"brain-host.example-tailnet.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:19000"}}}}}"#.to_string(),
            }
        }
    }

    const READY_STATUS: &str = r#"{"Version":"1.98.8","BackendState":"Running","Self":{"Online":true,"DNSName":"brain-host.example-tailnet.ts.net."}}"#;
    const SERVICE_CONFIG: &str = r#"{"version":"0.0.1","services":{"svc:unrelated":{"endpoints":{"tcp:8443":"http://127.0.0.1:19004"}}}}"#;
    const CHANGED_SERVICE_CONFIG: &str = r#"{"version":"0.0.1","services":{"svc:unrelated":{"endpoints":{"tcp:8443":"http://127.0.0.1:19005"}}}}"#;

    fn success(stdout: &[u8]) -> CapturedOutput {
        CapturedOutput {
            exit_code: Some(0),
            stdout: stdout.to_vec(),
            stderr: Vec::new(),
        }
    }

    fn enabled_state(port: u16) -> TailscaleAccessConfig {
        TailscaleAccessConfig::enabled(&ManagedMapping::new(port).unwrap())
    }

    #[test]
    fn tailscale_access_eligibility_and_owner_gates_precede_all_external_changes() {
        for (deployment, owner, code) in [
            (
                DeploymentMode::Managed,
                true,
                TailscaleErrorCode::IneligibleDeployment,
            ),
            (
                DeploymentMode::Local,
                false,
                TailscaleErrorCode::OwnerNotInitialized,
            ),
        ] {
            let mut backend = FakeBackend {
                deployment,
                owner,
                ..FakeBackend::default()
            };
            let status = perform(&mut backend, LifecycleAction::Enable, "gate-test");
            assert_eq!(status.error_code, Some(code));
            assert!(backend.calls.is_empty());
            assert!(backend.bridge_port.is_none());
        }
    }

    #[test]
    fn tailscale_access_enable_health_checks_bridge_before_mutation_and_reads_back() {
        let mut backend = FakeBackend::default();
        let status = perform(&mut backend, LifecycleAction::Enable, "enable-test");
        assert_eq!(status.state, TailscaleAccessState::Running);
        assert_eq!(status.ownership, ServeOwnership::OwnedExact);
        assert_eq!(
            status.access_url.as_deref(),
            Some("https://brain-host.example-tailnet.ts.net/")
        );
        assert_eq!(
            backend.calls,
            vec![
                TailscaleCommandKind::Version,
                TailscaleCommandKind::Status,
                TailscaleCommandKind::ServeStatus,
                TailscaleCommandKind::ServeConfig,
                TailscaleCommandKind::Enable,
                TailscaleCommandKind::Version,
                TailscaleCommandKind::Status,
                TailscaleCommandKind::ServeStatus,
                TailscaleCommandKind::ServeConfig,
            ]
        );
        let Ok(StateLoad::Loaded(saved)) = backend.state else {
            panic!("enabled state should be saved")
        };
        assert!(saved.desired_enabled);
        assert_eq!(saved.schema_version, STATE_SCHEMA_VERSION);
    }

    #[test]
    fn tailscale_access_failures_issue_no_mutation_and_preserve_browser_access() {
        let mut conflict = FakeBackend {
            live: LiveServe::Unowned,
            ..FakeBackend::default()
        };
        let status = perform(&mut conflict, LifecycleAction::Enable, "conflict-test");
        assert_eq!(status.state, TailscaleAccessState::Conflict);
        assert!(!conflict.calls.contains(&TailscaleCommandKind::Enable));
        assert_eq!(conflict.browser_access_sentinel, "browser-access-running");

        let mut bridge_failure = FakeBackend {
            start_error: Some(TailscaleErrorCode::BridgeUnavailable),
            ..FakeBackend::default()
        };
        let status = perform(&mut bridge_failure, LifecycleAction::Enable, "bridge-test");
        assert_eq!(
            status.error_code,
            Some(TailscaleErrorCode::BridgeUnavailable)
        );
        assert!(!bridge_failure.calls.contains(&TailscaleCommandKind::Enable));
        assert_eq!(
            bridge_failure.browser_access_sentinel,
            "browser-access-running"
        );
    }

    #[test]
    fn tailscale_access_retry_is_idempotent_for_an_exact_owned_mapping() {
        let mapping = ManagedMapping::new(MANAGED_LOOPBACK_PORT_START).unwrap();
        let mut backend = FakeBackend {
            state: Ok(StateLoad::Loaded(TailscaleAccessConfig::enabled(&mapping))),
            live: LiveServe::Exact(mapping.loopback_port()),
            bridge_port: Some(mapping.loopback_port()),
            ..FakeBackend::default()
        };
        let first = perform(&mut backend, LifecycleAction::Retry, "retry-one");
        let second = perform(&mut backend, LifecycleAction::Retry, "retry-two");
        assert_eq!(first.state, TailscaleAccessState::Running);
        assert_eq!(second.state, TailscaleAccessState::Running);
        assert!(!backend.calls.contains(&TailscaleCommandKind::Enable));
    }

    #[test]
    fn tailscale_access_startup_recreates_only_with_valid_saved_ownership() {
        let mapping = ManagedMapping::new(MANAGED_LOOPBACK_PORT_START + 1).unwrap();
        let mut backend = FakeBackend {
            state: Ok(StateLoad::Loaded(TailscaleAccessConfig::enabled(&mapping))),
            live: LiveServe::Absent,
            ..FakeBackend::default()
        };
        let status = perform(&mut backend, LifecycleAction::Startup, "startup-test");
        assert_eq!(status.state, TailscaleAccessState::Running);
        assert_eq!(backend.bridge_port, Some(mapping.loopback_port()));
        assert_eq!(
            backend
                .calls
                .iter()
                .filter(|kind| **kind == TailscaleCommandKind::Enable)
                .count(),
            1
        );

        let mut stale = FakeBackend {
            state: Err(StateErrorCode::StaleOwnership),
            ..FakeBackend::default()
        };
        let status = perform(&mut stale, LifecycleAction::Startup, "stale-test");
        assert_eq!(status.state, TailscaleAccessState::NeedsAttention);
        assert!(stale.calls.is_empty());
    }

    #[test]
    fn tailscale_access_disable_requires_exact_ownership_and_targeted_read_back() {
        let mapping = ManagedMapping::new(MANAGED_LOOPBACK_PORT_START).unwrap();
        let mut backend = FakeBackend {
            state: Ok(StateLoad::Loaded(TailscaleAccessConfig::enabled(&mapping))),
            live: LiveServe::Exact(mapping.loopback_port()),
            bridge_port: Some(mapping.loopback_port()),
            ..FakeBackend::default()
        };
        let status = perform(&mut backend, LifecycleAction::Disable, "disable-test");
        assert_eq!(status.state, TailscaleAccessState::Off);
        assert_eq!(
            backend
                .calls
                .iter()
                .filter(|kind| **kind == TailscaleCommandKind::Disable)
                .count(),
            1
        );
        assert!(backend.bridge_port.is_none());
        assert_eq!(backend.browser_access_sentinel, "browser-access-running");

        let mut drifted = FakeBackend {
            state: Ok(StateLoad::Loaded(enabled_state(
                MANAGED_LOOPBACK_PORT_START,
            ))),
            live: LiveServe::Unowned,
            ..FakeBackend::default()
        };
        let status = perform(&mut drifted, LifecycleAction::Disable, "drifted-test");
        assert_eq!(status.state, TailscaleAccessState::Conflict);
        assert!(!drifted.calls.contains(&TailscaleCommandKind::Disable));

        let mapping = ManagedMapping::new(MANAGED_LOOPBACK_PORT_START).unwrap();
        let mut timeout_with_effect = FakeBackend {
            state: Ok(StateLoad::Loaded(TailscaleAccessConfig::enabled(&mapping))),
            live: LiveServe::Exact(mapping.loopback_port()),
            bridge_port: Some(mapping.loopback_port()),
            disable_error: Some(RunnerError::Timeout),
            ..FakeBackend::default()
        };
        let status = perform(
            &mut timeout_with_effect,
            LifecycleAction::Disable,
            "disable-timeout-test",
        );
        assert_eq!(status.state, TailscaleAccessState::Off);
    }

    #[test]
    fn tailscale_access_failures_never_claim_unverified_ownership() {
        let mut consent = FakeBackend {
            consent: true,
            mutate_on_enable: false,
            ..FakeBackend::default()
        };
        let status = perform(&mut consent, LifecycleAction::Enable, "consent-test");
        assert_eq!(status.state, TailscaleAccessState::NeedsSetup);
        assert!(status
            .setup_url
            .as_deref()
            .unwrap()
            .starts_with("https://login.tailscale.com/"));
        assert!(consent.bridge_port.is_none());

        let mut ambiguous = FakeBackend {
            mutate_on_enable: false,
            ..FakeBackend::default()
        };
        let status = perform(&mut ambiguous, LifecycleAction::Enable, "ambiguous-test");
        assert_eq!(status.state, TailscaleAccessState::NeedsAttention);
        assert!(matches!(ambiguous.state, Ok(StateLoad::Missing)));

        let mut persistence = FakeBackend {
            persistence_fails: true,
            ..FakeBackend::default()
        };
        let status = perform(
            &mut persistence,
            LifecycleAction::Enable,
            "persistence-test",
        );
        assert_eq!(status.error_code, Some(TailscaleErrorCode::Persistence));
        assert!(!status.desired_enabled);
        assert_eq!(status.ownership, ServeOwnership::Ambiguous);
        assert!(matches!(persistence.state, Ok(StateLoad::Missing)));
        assert!(matches!(persistence.live, LiveServe::Exact(_)));

        let mut timeout_with_effect = FakeBackend {
            enable_error: Some(RunnerError::Timeout),
            ..FakeBackend::default()
        };
        let status = perform(
            &mut timeout_with_effect,
            LifecycleAction::Enable,
            "timeout-effect-test",
        );
        assert_eq!(status.state, TailscaleAccessState::Running);

        let mut timeout_without_effect = FakeBackend {
            mutate_on_enable: false,
            enable_error: Some(RunnerError::Timeout),
            ..FakeBackend::default()
        };
        let status = perform(
            &mut timeout_without_effect,
            LifecycleAction::Enable,
            "timeout-no-effect-test",
        );
        assert_eq!(status.state, TailscaleAccessState::NeedsAttention);
        assert_eq!(status.bridge_state, TailnetBridgeState::Stopped);
        assert_eq!(status.error_code, Some(TailscaleErrorCode::CommandTimeout));
        assert!(status.message.contains("HTTPS Serve setup did not finish"));
        assert!(matches!(
            timeout_without_effect.state,
            Ok(StateLoad::Missing)
        ));

        let mut unrelated_changed = FakeBackend {
            change_unrelated_on_enable: true,
            ..FakeBackend::default()
        };
        let status = perform(
            &mut unrelated_changed,
            LifecycleAction::Enable,
            "preservation-test",
        );
        assert_eq!(status.state, TailscaleAccessState::NeedsAttention);
        assert!(matches!(unrelated_changed.state, Ok(StateLoad::Missing)));
    }

    #[test]
    fn tailscale_access_repeated_disable_and_shutdown_are_safe() {
        let mut backend = FakeBackend {
            state: Ok(StateLoad::Loaded(TailscaleAccessConfig::disabled())),
            bridge_port: Some(MANAGED_LOOPBACK_PORT_START),
            ..FakeBackend::default()
        };
        let first = perform(&mut backend, LifecycleAction::Disable, "off-one");
        let second = perform(&mut backend, LifecycleAction::Disable, "off-two");
        assert_eq!(first.state, TailscaleAccessState::Off);
        assert_eq!(second.state, TailscaleAccessState::Off);
        assert!(!backend.calls.contains(&TailscaleCommandKind::Disable));

        backend.live = LiveServe::Exact(MANAGED_LOOPBACK_PORT_START);
        backend.bridge_port = Some(MANAGED_LOOPBACK_PORT_START);
        let calls_before = backend.calls.len();
        shutdown(&mut backend, "shutdown-test");
        assert!(backend.bridge_port.is_none());
        assert!(matches!(backend.live, LiveServe::Exact(_)));
        assert_eq!(backend.calls.len(), calls_before);
    }

    #[test]
    fn tailscale_access_serialized_guard_prevents_overlapping_mutations() {
        let backend = Arc::new(Mutex::new(FakeBackend::default()));
        let barrier = Arc::new(Barrier::new(3));
        let mut handles = Vec::new();
        for index in 0..2 {
            let backend = backend.clone();
            let barrier = barrier.clone();
            handles.push(thread::spawn(move || {
                barrier.wait();
                let mut backend = backend.lock().unwrap();
                perform(
                    &mut *backend,
                    LifecycleAction::Enable,
                    &format!("concurrent-{index}"),
                )
            }));
        }
        barrier.wait();
        for handle in handles {
            assert_eq!(handle.join().unwrap().state, TailscaleAccessState::Running);
        }
        let backend = backend.lock().unwrap();
        assert_eq!(
            backend
                .calls
                .iter()
                .filter(|kind| **kind == TailscaleCommandKind::Enable)
                .count(),
            1
        );
    }

    #[test]
    fn tailscale_access_diagnostics_and_status_contain_no_secrets() {
        let mut backend = FakeBackend::default();
        let status = perform(&mut backend, LifecycleAction::Enable, "safe-operation");
        let serialized = serde_json::to_string(&status).unwrap();
        let diagnostics = backend
            .diagnostics
            .iter()
            .map(DiagnosticEvent::to_json_line)
            .collect::<Vec<_>>()
            .join("\n");
        for prohibited in [
            "transport-secret",
            "secret-canary",
            "alice@example.com",
            "mappingFingerprint",
        ] {
            assert!(!serialized.contains(prohibited));
            assert!(!diagnostics.contains(prohibited));
        }
    }
}
