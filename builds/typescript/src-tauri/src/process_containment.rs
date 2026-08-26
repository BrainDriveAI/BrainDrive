use std::process::Child;

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

        #[cfg(not(windows))]
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
        Ok(())
    }

    pub fn terminate_all(&self) -> Result<(), String> {
        #[cfg(windows)]
        unsafe {
            if TerminateJobObject(self.job as *mut std::ffi::c_void, 1) == 0 {
                return Err("desktop process containment could not confirm termination".to_string());
            }
        }
        Ok(())
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
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "process_containment::tests::containment_child",
                "--ignored",
            ])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        containment.attach(&child).unwrap();
        let _ = child.kill();
        child.wait().unwrap();
    }
}
