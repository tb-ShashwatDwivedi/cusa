//! Windows SCM wrapper — starts and supervises cusa-agent.exe.
use std::ffi::OsString;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;
use windows_service::{
    define_windows_service,
    service::{
        ServiceControl, ServiceControlAccept, ServiceExitCode, ServiceState, ServiceStatus,
        ServiceType,
    },
    service_control_handler::{self, ServiceControlHandlerResult},
    service_dispatcher,
};

const SERVICE_NAME: &str = "CUSAAgent";
const AGENT_EXE: &str = "cusa-agent.exe";
const DATA_DIR: &str = r"C:\ProgramData\CUSA";

static CHILD: Mutex<Option<Child>> = Mutex::new(None);

define_windows_service!(ffi_service_main, service_main);

fn main() {
    if std::env::args().any(|a| a == "--console") {
        run_agent_child();
        return;
    }
    if let Err(e) = service_dispatcher::start(SERVICE_NAME, ffi_service_main) {
        eprintln!("CUSAAgent service dispatcher failed: {e}");
        std::process::exit(1);
    }
}

fn service_main(_arguments: Vec<OsString>) {
    if let Err(e) = run_service() {
        eprintln!("CUSAAgent service error: {e:?}");
    }
}

fn run_service() -> windows_service::Result<()> {
    let status_handle = service_control_handler::register(SERVICE_NAME, event_handler)?;

    status_handle.set_service_status(ServiceStatus {
        service_type: ServiceType::OWN_PROCESS,
        current_state: ServiceState::StartPending,
        controls_accepted: ServiceControlAccept::empty(),
        exit_code: ServiceExitCode::Win32(0),
        checkpoint: 0,
        wait_hint: Duration::from_secs(10),
        process_id: None,
    })?;

    spawn_agent_child().map_err(|e| windows_service::Error::Winapi(std::io::Error::other(e)))?;

    status_handle.set_service_status(ServiceStatus {
        service_type: ServiceType::OWN_PROCESS,
        current_state: ServiceState::Running,
        controls_accepted: ServiceControlAccept::STOP | ServiceControlAccept::SHUTDOWN,
        exit_code: ServiceExitCode::Win32(0),
        checkpoint: 0,
        wait_hint: Duration::default(),
        process_id: None,
    })?;

    loop {
        let running = CHILD.lock().ok().map(|mut g| {
            g.as_mut()
                .map(|c| c.try_wait().ok().flatten().is_none())
                .unwrap_or(false)
        }).unwrap_or(false);
        if !running {
            break;
        }
        std::thread::sleep(Duration::from_secs(2));
    }

    status_handle.set_service_status(ServiceStatus {
        service_type: ServiceType::OWN_PROCESS,
        current_state: ServiceState::Stopped,
        controls_accepted: ServiceControlAccept::empty(),
        exit_code: ServiceExitCode::Win32(0),
        checkpoint: 0,
        wait_hint: Duration::default(),
        process_id: None,
    })?;

    Ok(())
}

fn event_handler(control: ServiceControl) -> ServiceControlHandlerResult {
    match control {
        ServiceControl::Stop | ServiceControl::Shutdown => {
            stop_agent_child();
            ServiceControlHandlerResult::NoError
        }
        ServiceControl::Interrogate => ServiceControlHandlerResult::NoError,
        _ => ServiceControlHandlerResult::NotImplemented,
    }
}

fn agent_paths() -> (PathBuf, PathBuf) {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from(r"C:\Program Files\CUSA\agent"));
    let agent = exe_dir.join(AGENT_EXE);
    let config = exe_dir.join("config").join("default.json");
    (agent, config)
}

fn spawn_agent_child() -> std::io::Result<()> {
    let (agent, config) = agent_paths();
    let log_dir = PathBuf::from(DATA_DIR).join("logs").join("agent");
    let _ = std::fs::create_dir_all(&log_dir);
    let mut cmd = Command::new(&agent);
    cmd.current_dir(agent.parent().unwrap_or(&agent))
        .env("CUSA_DATA_DIR", DATA_DIR)
        .env("CUSA_CONFIG", config);
    if let Ok(log) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_dir.join("service-host.log"))
    {
        let err = log.try_clone()?;
        cmd.stdout(log).stderr(err);
    } else {
        cmd.stdout(Stdio::null()).stderr(Stdio::null());
    }
    let child = cmd.spawn()?;
    if let Ok(mut guard) = CHILD.lock() {
        *guard = Some(child);
    }
    Ok(())
}

fn run_agent_child() {
    let (agent, config) = agent_paths();
    let status = Command::new(&agent)
        .current_dir(agent.parent().unwrap_or(&agent))
        .env("CUSA_DATA_DIR", DATA_DIR)
        .env("CUSA_CONFIG", config)
        .status();
    std::process::exit(status.map(|s| s.code().unwrap_or(1)).unwrap_or(1));
}

fn stop_agent_child() {
    if let Ok(mut guard) = CHILD.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}
