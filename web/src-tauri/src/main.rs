#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use keyring::Entry;
use rand::{distributions::Alphanumeric, Rng};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    env,
    fs::{self, File, OpenOptions},
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{mpsc, Arc, Mutex},
    thread,
    time::Duration,
};
use tauri::{AppHandle, Manager, State};

#[cfg(windows)]
use std::os::windows::{io::AsRawHandle, process::CommandExt};
#[cfg(windows)]
use windows_sys::Win32::{
    Foundation::{CloseHandle, GetLastError, HANDLE},
    System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    },
};

const CREDENTIAL_SERVICE: &str = "InfiniteCanvas";
const AGENT_KEY_ENV: &str = "INFINITE_CANVAS_AGENT_API_KEY";
const READY_PREFIX: &str = "CANVAS_AGENT_READY ";
const START_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentProviderRequest {
    base_url: String,
    api_key: String,
    model: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopAgentReady {
    url: String,
    token: String,
    log_path: String,
}

#[derive(Debug, Deserialize)]
struct ReadyLine {
    url: String,
    token: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CredentialRequest {
    channels: Vec<ChannelCredential>,
    #[serde(default)]
    webdav_password: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChannelCredential {
    id: String,
    #[serde(default)]
    api_key: String,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopCredentials {
    channels: BTreeMap<String, String>,
    webdav_password: String,
}

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CredentialIndex {
    channel_ids: BTreeSet<String>,
}

#[derive(Serialize)]
struct CodexConfig<'a> {
    model: &'a str,
    model_provider: &'static str,
    model_providers: BTreeMap<&'static str, CodexProvider<'a>>,
}

#[derive(Serialize)]
struct CodexProvider<'a> {
    name: &'static str,
    base_url: &'a str,
    env_key: &'static str,
    wire_api: &'static str,
}

struct ManagedAgent {
    child: Child,
    #[cfg(windows)]
    job: JobHandle,
    ready: DesktopAgentReady,
}

#[derive(Clone)]
struct AgentSupervisor {
    app: AppHandle,
    process: Arc<Mutex<Option<ManagedAgent>>>,
    provider: Arc<Mutex<Option<AgentProviderRequest>>>,
    start_lock: Arc<Mutex<()>>,
}

impl AgentSupervisor {
    fn new(app: AppHandle) -> Self {
        Self {
            app,
            process: Arc::new(Mutex::new(None)),
            provider: Arc::new(Mutex::new(None)),
            start_lock: Arc::new(Mutex::new(())),
        }
    }

    fn ensure_started(&self) -> Result<DesktopAgentReady, String> {
        let _start_guard = self.start_lock.lock().map_err(|_| "Agent start lock is unavailable".to_string())?;
        if let Some(ready) = self.running_ready()? {
            return Ok(ready);
        }
        let provider = self.provider.lock().map_err(|_| "Agent provider state is unavailable".to_string())?.clone();
        self.start_with_retries(provider.as_ref())
    }

    fn configure(&self, request: AgentProviderRequest) -> Result<DesktopAgentReady, String> {
        let _start_guard = self.start_lock.lock().map_err(|_| "Agent start lock is unavailable".to_string())?;
        validate_provider(&request)?;
        write_codex_config(&self.app, &request)?;
        *self.provider.lock().map_err(|_| "Agent provider state is unavailable".to_string())? = Some(request.clone());
        self.stop_locked()?;
        self.start_with_retries(Some(&request))
    }

    fn clear_configuration(&self) -> Result<DesktopAgentReady, String> {
        let _start_guard = self.start_lock.lock().map_err(|_| "Agent start lock is unavailable".to_string())?;
        self.stop_locked()?;
        *self.provider.lock().map_err(|_| "Agent provider state is unavailable".to_string())? = None;
        remove_codex_config(&self.app)?;
        self.start_with_retries(None)
    }

    fn restart(&self) -> Result<DesktopAgentReady, String> {
        let _start_guard = self.start_lock.lock().map_err(|_| "Agent start lock is unavailable".to_string())?;
        let provider = self.provider.lock().map_err(|_| "Agent provider state is unavailable".to_string())?.clone();
        self.stop_locked()?;
        self.start_with_retries(provider.as_ref())
    }

    fn running_ready(&self) -> Result<Option<DesktopAgentReady>, String> {
        let mut process = self.process.lock().map_err(|_| "Agent process state is unavailable".to_string())?;
        let Some(agent) = process.as_mut() else { return Ok(None) };
        match agent.child.try_wait().map_err(|error| format!("Unable to inspect Canvas Agent: {error}"))? {
            None => Ok(Some(agent.ready.clone())),
            Some(_) => {
                process.take();
                Ok(None)
            }
        }
    }

    fn start_with_retries(&self, provider: Option<&AgentProviderRequest>) -> Result<DesktopAgentReady, String> {
        let delays = [Duration::from_secs(1), Duration::from_secs(3)];
        let mut errors = Vec::new();
        for attempt in 0..3 {
            match self.start_once(provider) {
                Ok(agent) => {
                    let ready = agent.ready.clone();
                    *self.process.lock().map_err(|_| "Agent process state is unavailable".to_string())? = Some(agent);
                    return Ok(ready);
                }
                Err(error) => errors.push(format!("attempt {}: {error}", attempt + 1)),
            }
            if let Some(delay) = delays.get(attempt) {
                thread::sleep(*delay);
            }
        }
        let log_path = agent_log_path(&self.app).map(|path| path.display().to_string()).unwrap_or_else(|_| "unavailable".to_string());
        Err(format!("Canvas Agent failed to start after 3 attempts. Log: {log_path}. {}", errors.join(" | ")))
    }

    fn start_once(&self, provider: Option<&AgentProviderRequest>) -> Result<ManagedAgent, String> {
        let node_path = find_node_path(&self.app)?;
        let script_path = find_agent_script(&self.app)?;
        let app_data = self.app.path().app_data_dir().map_err(|error| format!("Unable to locate app data: {error}"))?;
        let agent_config = app_data.join("agent");
        let codex_home = app_data.join("codex");
        fs::create_dir_all(&agent_config).map_err(|error| format!("Unable to create Agent data directory: {error}"))?;
        fs::create_dir_all(&codex_home).map_err(|error| format!("Unable to create Codex data directory: {error}"))?;

        let log_path = agent_log_path(&self.app)?;
        if let Some(parent) = log_path.parent() {
            fs::create_dir_all(parent).map_err(|error| format!("Unable to create log directory: {error}"))?;
        }
        let log = Arc::new(Mutex::new(OpenOptions::new().create(true).append(true).open(&log_path).map_err(|error| format!("Unable to open Agent log: {error}"))?));
        write_log(&log, "Starting bundled Canvas Agent");

        let token: String = rand::thread_rng().sample_iter(&Alphanumeric).take(48).map(char::from).collect();
        let provider_secret = provider.map(|provider| provider.api_key.clone());
        let mut command = Command::new(&node_path);
        command
            .arg(&script_path)
            .env("PORT", "0")
            .env("CANVAS_AGENT_TOKEN", &token)
            .env("CANVAS_AGENT_EPHEMERAL_TOKEN", "1")
            .env("CANVAS_AGENT_LAZY_CODEX", "1")
            .env("CANVAS_AGENT_CONFIG_DIR", &agent_config)
            .env("CODEX_HOME", &codex_home)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(secret) = provider_secret.as_deref() {
            command.env(AGENT_KEY_ENV, secret);
        }
        #[cfg(windows)]
        command.creation_flags(0x0800_0000);

        let mut child = command.spawn().map_err(|error| format!("Unable to launch bundled Node runtime at {}: {error}", node_path.display()))?;
        #[cfg(windows)]
        let job = match JobHandle::attach(&child) {
            Ok(job) => job,
            Err(error) => {
                terminate_child(&mut child);
                return Err(error);
            }
        };

        let Some(stdout) = child.stdout.take() else {
            terminate_child(&mut child);
            return Err("Canvas Agent stdout was not captured".to_string());
        };
        let Some(stderr) = child.stderr.take() else {
            terminate_child(&mut child);
            return Err("Canvas Agent stderr was not captured".to_string());
        };
        let (ready_tx, ready_rx) = mpsc::channel::<ReadyLine>();
        let stdout_log = Arc::clone(&log);
        let stdout_secret = provider_secret.clone();
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if let Some(payload) = line.strip_prefix(READY_PREFIX) {
                    write_log(&stdout_log, "CANVAS_AGENT_READY [redacted]");
                    if let Ok(ready) = serde_json::from_str::<ReadyLine>(payload) {
                        let _ = ready_tx.send(ready);
                    }
                } else {
                    write_log(&stdout_log, &redact_agent_log_line(&line, stdout_secret.as_deref()));
                }
            }
        });
        let stderr_log = Arc::clone(&log);
        let stderr_secret = provider_secret;
        thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                write_log(&stderr_log, &redact_agent_log_line(&line, stderr_secret.as_deref()));
            }
        });

        match ready_rx.recv_timeout(START_TIMEOUT) {
            Ok(ready) if ready.token == token && is_loopback_url(&ready.url) => Ok(ManagedAgent {
                child,
                #[cfg(windows)]
                job,
                ready: DesktopAgentReady { url: ready.url, token, log_path: log_path.display().to_string() },
            }),
            Ok(_) => {
                terminate_child(&mut child);
                Err("Canvas Agent returned an invalid readiness message".to_string())
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                terminate_child(&mut child);
                Err("Canvas Agent did not become ready within 15 seconds".to_string())
            }
            Err(error) => {
                terminate_child(&mut child);
                Err(format!("Canvas Agent readiness channel closed: {error}"))
            }
        }
    }

    fn stop(&self) {
        let _ = self.stop_locked();
    }

    fn stop_locked(&self) -> Result<(), String> {
        let mut process = self.process.lock().map_err(|_| "Agent process state is unavailable".to_string())?;
        if let Some(mut agent) = process.take() {
            #[cfg(windows)]
            drop(agent.job);
            terminate_child(&mut agent.child);
        }
        Ok(())
    }
}

#[cfg(windows)]
struct JobHandle(isize);

#[cfg(windows)]
impl JobHandle {
    fn attach(child: &Child) -> Result<Self, String> {
        unsafe {
            let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if handle.is_null() {
                return Err(format!("Unable to create Windows Job Object: {}", GetLastError()));
            }
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let configured = SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const std::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            if configured == 0 || AssignProcessToJobObject(handle, child.as_raw_handle() as HANDLE) == 0 {
                let error = GetLastError();
                CloseHandle(handle);
                return Err(format!("Unable to contain Canvas Agent process tree: {error}"));
            }
            Ok(Self(handle as isize))
        }
    }
}

#[cfg(windows)]
impl Drop for JobHandle {
    fn drop(&mut self) {
        unsafe {
            if self.0 != 0 {
                CloseHandle(self.0 as HANDLE);
            }
        }
    }
}

fn terminate_child(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

fn write_log(log: &Arc<Mutex<File>>, line: &str) {
    if let Ok(mut file) = log.lock() {
        let _ = writeln!(file, "{line}");
        let _ = file.flush();
    }
}

fn redact_agent_log_line(line: &str, provider_secret: Option<&str>) -> String {
    if let Some(index) = line.find("Connect token:") {
        return format!("{}Connect token: [redacted]", &line[..index]);
    }
    if line.contains(READY_PREFIX) {
        return "CANVAS_AGENT_READY [redacted]".to_string();
    }
    match provider_secret.filter(|secret| !secret.is_empty()) {
        Some(secret) => line.replace(secret, "[redacted]"),
        None => line.to_string(),
    }
}

fn is_loopback_url(value: &str) -> bool {
    value.starts_with("http://127.0.0.1:") || value.starts_with("http://localhost:")
}

fn find_node_path(app: &AppHandle) -> Result<PathBuf, String> {
    let resource_dir = app.path().resource_dir().map_err(|error| format!("Unable to locate desktop resources: {error}"))?;
    let executable_dir = env::current_exe().ok().and_then(|path| path.parent().map(Path::to_path_buf));
    let mut candidates = vec![resource_dir.join("node.exe"), resource_dir.join("binaries/node.exe")];
    if let Some(directory) = executable_dir {
        candidates.push(directory.join("node.exe"));
        candidates.push(directory.join("binaries/node.exe"));
    }
    first_existing(candidates, "bundled Node runtime")
}

fn find_agent_script(app: &AppHandle) -> Result<PathBuf, String> {
    let resource_dir = app.path().resource_dir().map_err(|error| format!("Unable to locate desktop resources: {error}"))?;
    first_existing(
        vec![
            resource_dir.join("canvas-agent/dist/index.js"),
            resource_dir.join("resources/canvas-agent/dist/index.js"),
        ],
        "bundled Canvas Agent",
    )
}

fn first_existing(candidates: Vec<PathBuf>, label: &str) -> Result<PathBuf, String> {
    candidates
        .iter()
        .find(|path| path.is_file())
        .cloned()
        .ok_or_else(|| format!("Unable to find {label}. Checked: {}", candidates.iter().map(|path| path.display().to_string()).collect::<Vec<_>>().join(", ")))
}

fn agent_log_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_log_dir().map(|path| path.join("agent.log")).map_err(|error| format!("Unable to locate log directory: {error}"))
}

fn validate_provider(request: &AgentProviderRequest) -> Result<(), String> {
    let base_url = request.base_url.trim();
    if !(base_url.starts_with("http://") || base_url.starts_with("https://")) {
        return Err("Agent provider URL must use http:// or https://".to_string());
    }
    if request.api_key.trim().is_empty() {
        return Err("Agent provider API key is required".to_string());
    }
    if request.model.trim().is_empty() {
        return Err("Agent text model is required".to_string());
    }
    Ok(())
}

fn write_codex_config(app: &AppHandle, request: &AgentProviderRequest) -> Result<(), String> {
    let codex_home = app.path().app_data_dir().map_err(|error| format!("Unable to locate app data: {error}"))?.join("codex");
    fs::create_dir_all(&codex_home).map_err(|error| format!("Unable to create Codex data directory: {error}"))?;
    let mut providers = BTreeMap::new();
    providers.insert(
        "infinite_canvas",
        CodexProvider {
            name: "Infinite Canvas provider",
            base_url: request.base_url.trim_end_matches('/'),
            env_key: AGENT_KEY_ENV,
            wire_api: "responses",
        },
    );
    let config = CodexConfig { model: request.model.trim(), model_provider: "infinite_canvas", model_providers: providers };
    let mut contents = toml::to_string_pretty(&config).map_err(|error| format!("Unable to encode Codex configuration: {error}"))?;
    contents.push('\n');
    fs::write(codex_home.join("config.toml"), contents).map_err(|error| format!("Unable to write Codex configuration: {error}"))
}

fn remove_codex_config(app: &AppHandle) -> Result<(), String> {
    let path = app.path().app_data_dir().map_err(|error| format!("Unable to locate app data: {error}"))?.join("codex/config.toml");
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Unable to remove Codex configuration: {error}")),
    }
}

fn credential_entry(account: &str) -> Result<Entry, String> {
    Entry::new(CREDENTIAL_SERVICE, account).map_err(|error| format!("Unable to access Windows credentials: {error}"))
}

fn read_secret(account: &str) -> Result<String, String> {
    match credential_entry(account)?.get_password() {
        Ok(secret) => Ok(secret),
        Err(keyring::Error::NoEntry) => Ok(String::new()),
        Err(error) => Err(format!("Unable to read Windows credentials: {error}")),
    }
}

fn write_secret(account: &str, secret: &str) -> Result<(), String> {
    let entry = credential_entry(account)?;
    if secret.is_empty() {
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(format!("Unable to remove Windows credentials: {error}")),
        }
    } else {
        entry.set_password(secret).map_err(|error| format!("Unable to store Windows credentials: {error}"))
    }
}

fn credential_index_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map(|path| path.join("credential-index.json")).map_err(|error| format!("Unable to locate app data: {error}"))
}

fn read_credential_index(app: &AppHandle) -> CredentialIndex {
    credential_index_path(app)
        .ok()
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|contents| serde_json::from_str(&contents).ok())
        .unwrap_or_default()
}

fn write_credential_index(app: &AppHandle, index: &CredentialIndex) -> Result<(), String> {
    let path = credential_index_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("Unable to create app data directory: {error}"))?;
    }
    let contents = serde_json::to_vec_pretty(index).map_err(|error| format!("Unable to encode credential index: {error}"))?;
    fs::write(path, contents).map_err(|error| format!("Unable to write credential index: {error}"))
}

fn channel_account(id: &str) -> String {
    format!("channel:{id}")
}

fn hydrate_credentials(app: &AppHandle, request: CredentialRequest) -> Result<DesktopCredentials, String> {
    let mut result = DesktopCredentials::default();
    let mut index = read_credential_index(app);
    for channel in request.channels {
        let account = channel_account(&channel.id);
        let mut secret = read_secret(&account)?;
        if secret.is_empty() && !channel.api_key.is_empty() {
            write_secret(&account, &channel.api_key)?;
            secret = channel.api_key;
        }
        index.channel_ids.insert(channel.id.clone());
        result.channels.insert(channel.id, secret);
    }
    let mut webdav_password = read_secret("webdav:password")?;
    if webdav_password.is_empty() && !request.webdav_password.is_empty() {
        write_secret("webdav:password", &request.webdav_password)?;
        webdav_password = request.webdav_password;
    }
    result.webdav_password = webdav_password;
    write_credential_index(app, &index)?;
    Ok(result)
}

fn sync_credentials(app: &AppHandle, request: CredentialRequest) -> Result<(), String> {
    let previous = read_credential_index(app);
    let current_ids: BTreeSet<String> = request.channels.iter().map(|channel| channel.id.clone()).collect();
    for removed in previous.channel_ids.difference(&current_ids) {
        write_secret(&channel_account(removed), "")?;
    }
    for channel in request.channels {
        write_secret(&channel_account(&channel.id), &channel.api_key)?;
    }
    write_secret("webdav:password", &request.webdav_password)?;
    write_credential_index(app, &CredentialIndex { channel_ids: current_ids })
}

#[tauri::command]
async fn desktop_bootstrap(state: State<'_, AgentSupervisor>) -> Result<DesktopAgentReady, String> {
    let supervisor = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || supervisor.ensure_started()).await.map_err(|error| format!("Agent startup task failed: {error}"))?
}

#[tauri::command]
async fn configure_desktop_agent(state: State<'_, AgentSupervisor>, request: AgentProviderRequest) -> Result<DesktopAgentReady, String> {
    let supervisor = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || supervisor.configure(request)).await.map_err(|error| format!("Agent configuration task failed: {error}"))?
}

#[tauri::command]
async fn clear_desktop_agent_configuration(state: State<'_, AgentSupervisor>) -> Result<DesktopAgentReady, String> {
    let supervisor = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || supervisor.clear_configuration()).await.map_err(|error| format!("Agent configuration task failed: {error}"))?
}

#[tauri::command]
async fn restart_desktop_agent(state: State<'_, AgentSupervisor>) -> Result<DesktopAgentReady, String> {
    let supervisor = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || supervisor.restart()).await.map_err(|error| format!("Agent restart task failed: {error}"))?
}

#[tauri::command]
async fn hydrate_desktop_credentials(app: AppHandle, request: CredentialRequest) -> Result<DesktopCredentials, String> {
    tauri::async_runtime::spawn_blocking(move || hydrate_credentials(&app, request)).await.map_err(|error| format!("Credential task failed: {error}"))?
}

#[tauri::command]
async fn sync_desktop_credentials(app: AppHandle, request: CredentialRequest) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || sync_credentials(&app, request)).await.map_err(|error| format!("Credential task failed: {error}"))?
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            app.manage(AgentSupervisor::new(app.handle().clone()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            desktop_bootstrap,
            configure_desktop_agent,
            clear_desktop_agent_configuration,
            restart_desktop_agent,
            hydrate_desktop_credentials,
            sync_desktop_credentials,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build Infinite Canvas desktop application");

    app.run(|app_handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            app_handle.state::<AgentSupervisor>().stop();
        }
    });
}
