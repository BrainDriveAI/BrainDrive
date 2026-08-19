use std::process::Child;
#[cfg(unix)]
use std::sync::{Arc, Mutex, OnceLock};

#[cfg(windows)]
use std::os::windows::io::AsRawHandle;
#[cfg(windows)]
use windows_sys::Win32::{
    Foundation::CloseHandle,
    System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectCpuRateControlInformation,
        JobObjectExtendedLimitInformation, SetInformationJobObject, TerminateJobObject,
        JOBOBJECT_CPU_RATE_CONTROL_INFORMATION, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_CPU_RATE_CONTROL_ENABLE, JOB_OBJECT_CPU_RATE_CONTROL_HARD_CAP,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JOB_OBJECT_LIMIT_PROCESS_MEMORY,
    },
};

#[cfg(windows)]
const PROCESS_MEMORY_LIMIT_BYTES: usize = 512 * 1024 * 1024;

/// Contains the desktop runtime and every descendant sidecar in one Windows job.
/// Closing the job is the final fail-safe after normal lifecycle shutdown.
pub struct ProcessContainment {
    #[cfg(windows)]
    job: isize,
    #[cfg(unix)]
    process_groups: Arc<Mutex<Vec<i32>>>,
}

#[cfg(unix)]
static ACTIVE_PROCESS_GROUPS: OnceLock<Mutex<Option<Arc<Mutex<Vec<i32>>>>>> = OnceLock::new();
#[cfg(unix)]
static EXIT_HANDLER: OnceLock<Result<(), String>> = OnceLock::new();

#[cfg(unix)]
fn terminate_process_groups(process_groups: &Mutex<Vec<i32>>) -> Result<(), String> {
    let mut process_groups = process_groups
        .lock()
        .map_err(|_| "desktop process containment state is unavailable".to_string())?;
    for process_group in process_groups.drain(..) {
        let result = unsafe { libc::kill(-process_group, libc::SIGKILL) };
        if result != 0 {
            let error = std::io::Error::last_os_error();
            if error.raw_os_error() != Some(libc::ESRCH) {
                return Err("desktop process group could not be terminated".to_string());
            }
        }
    }
    Ok(())
}

#[cfg(unix)]
fn install_exit_handler(process_groups: &Arc<Mutex<Vec<i32>>>) -> Result<(), String> {
    let active = ACTIVE_PROCESS_GROUPS.get_or_init(|| Mutex::new(None));
    *active
        .lock()
        .map_err(|_| "desktop process containment state is unavailable".to_string())? =
        Some(Arc::clone(process_groups));

    EXIT_HANDLER
        .get_or_init(|| {
            ctrlc::set_handler(|| {
                if let Some(active) = ACTIVE_PROCESS_GROUPS.get() {
                    if let Ok(active) = active.lock() {
                        if let Some(process_groups) = active.as_ref() {
                            let _ = terminate_process_groups(process_groups);
                        }
                    }
                }
                std::process::exit(1);
            })
            .map_err(|error| {
                format!("desktop process exit handler could not be installed: {error}")
            })
        })
        .clone()
}

impl ProcessContainment {
    pub fn new() -> Result<Self, String> {
        #[cfg(windows)]
        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() {
                return Err("desktop process containment could not be created".to_string());
            }
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            limits.BasicLimitInformation.LimitFlags =
                JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_PROCESS_MEMORY;
            limits.ProcessMemoryLimit = PROCESS_MEMORY_LIMIT_BYTES;
            let configured = SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            if configured == 0 {
                CloseHandle(job);
                return Err("desktop process containment policy could not be applied".to_string());
            }
            let processor_count = std::thread::available_parallelism()
                .map(|count| count.get())
                .unwrap_or(1);
            let mut cpu = JOBOBJECT_CPU_RATE_CONTROL_INFORMATION::default();
            cpu.ControlFlags =
                JOB_OBJECT_CPU_RATE_CONTROL_ENABLE | JOB_OBJECT_CPU_RATE_CONTROL_HARD_CAP;
            cpu.Anonymous.CpuRate = (10_000usize / processor_count).max(1) as u32;
            let cpu_configured = SetInformationJobObject(
                job,
                JobObjectCpuRateControlInformation,
                (&cpu as *const JOBOBJECT_CPU_RATE_CONTROL_INFORMATION).cast(),
                std::mem::size_of::<JOBOBJECT_CPU_RATE_CONTROL_INFORMATION>() as u32,
            );
            if cpu_configured == 0 {
                CloseHandle(job);
                return Err("desktop CPU containment policy could not be applied".to_string());
            }
            return Ok(Self { job: job as isize });
        }

        #[cfg(all(not(windows), unix))]
        {
            let process_groups = Arc::new(Mutex::new(Vec::new()));
            install_exit_handler(&process_groups)?;
            return Ok(Self { process_groups });
        }

        #[cfg(not(any(windows, unix)))]
        Ok(Self {})
    }

    pub fn attach(&self, child: &Child) -> Result<(), String> {
        #[cfg(windows)]
        unsafe {
            if AssignProcessToJobObject(
                self.job as *mut std::ffi::c_void,
                child.as_raw_handle() as *mut std::ffi::c_void,
            ) == 0
            {
                return Err("desktop child could not enter process containment".to_string());
            }
        }
        #[cfg(not(windows))]
        let _ = child;
        #[cfg(unix)]
        self.process_groups
            .lock()
            .map_err(|_| "desktop process containment state is unavailable".to_string())?
            .push(child.id() as i32);
        Ok(())
    }

    pub fn terminate_all(&self) -> Result<(), String> {
        #[cfg(windows)]
        unsafe {
            if TerminateJobObject(self.job as *mut std::ffi::c_void, 1) == 0 {
                return Err("desktop process containment could not confirm termination".to_string());
            }
        }
        #[cfg(unix)]
        terminate_process_groups(&self.process_groups)?;
        Ok(())
    }
}

#[cfg(unix)]
impl Drop for ProcessContainment {
    fn drop(&mut self) {
        let _ = terminate_process_groups(&self.process_groups);
    }
}

#[cfg(windows)]
impl Drop for ProcessContainment {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.job as *mut std::ffi::c_void);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::{Command, Stdio};
    use std::time::Duration;

    #[test]
    #[ignore]
    fn containment_child() {
        std::thread::sleep(Duration::from_secs(30));
    }

    #[test]
    fn containment_accepts_a_bounded_child() {
        let containment = ProcessContainment::new().unwrap();
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "process_containment::tests::containment_child",
                "--ignored",
            ])
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }
        let mut child = command.spawn().unwrap();
        containment.attach(&child).unwrap();
        containment.terminate_all().unwrap();
        child.wait().unwrap();
    }
}
