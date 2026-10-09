//! Downloads Ollama’s official Windows standalone ZIP (upstream ``docs/windows.mdx``)
//! into app-local storage and runs ``ollama serve`` on a spare port so it does not
//! fight a normal desktop install on ``:11434``.

use std::{
    fs::File,
    io,
    path::{Path, PathBuf},
    time::Duration,
};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;

/// Pinned upstream release asset (update when validating a new ZIP layout).
pub const PINNED_VERSION: &str = "v0.5.11";
const WINDOWS_ZIP_FILENAME: &str = "ollama-windows-amd64.zip";
const BIND_HOSTPORT: (&str, u16) = ("127.0.0.1", 11435);

/// Origins the Scribble WebView uses when calling Ollama via ``fetch`` from the renderer.
/// Without this, bundled ``ollama serve`` often rejects Tauri on Windows (HTTP ``tauri.localhost``)
/// with a CORS failure even though the Rust health check passes.
const SCRIBBLE_OLLAMA_ORIGINS: &str = concat!(
    "http://tauri.localhost,https://tauri.localhost,",
    "tauri://localhost,",
    "http://127.0.0.1:5173,http://localhost:5173,",
    "http://127.0.0.1:1420,http://localhost:1420",
);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundledAiProbe {
    pub windows_embedding_supported: bool,
    pub pinned_ollama_version: &'static str,
    pub public_base_url: String,
    pub install_root_display: Option<String>,
    pub runtime_ready: bool,
    /// True when the runtime came from a folder shipped inside the installer
    /// (no separate download needed). Lets the UI hide the "Download" button
    /// entirely on machines that received a fully-bundled build.
    pub runtime_from_installer: bool,
    /// True if at least one model is already pre-staged next to the runtime,
    /// so the chat UI can skip the auto-pull step on first launch.
    pub model_preinstalled: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundledAiProgressPayload {
    pub phase: &'static str,
    pub bytes_done: Option<u64>,
    pub bytes_total: Option<u64>,
    pub message: String,
}

pub struct BundledAiState {
    server_child: Mutex<Option<tokio::process::Child>>,
    pub download_mu: Mutex<()>,
}

impl Default for BundledAiState {
    fn default() -> Self {
        Self {
            server_child: Mutex::new(None),
            download_mu: Mutex::default(),
        }
    }
}

impl BundledAiState {
    pub async fn shutdown_server(&self) {
        let mut g = self.server_child.lock().await;
        if let Some(mut ch) = g.take() {
            let _ = ch.kill().await;
            let _ = ch.wait().await;
        }
    }
}

#[cfg(not(windows))]
pub fn bundled_ai_probe(_app: &AppHandle) -> BundledAiProbe {
    BundledAiProbe {
        windows_embedding_supported: false,
        pinned_ollama_version: PINNED_VERSION,
        public_base_url: format!("http://{}:{}", BIND_HOSTPORT.0, BIND_HOSTPORT.1),
        install_root_display: None,
        runtime_ready: false,
        runtime_from_installer: false,
        model_preinstalled: false,
    }
}

#[cfg(not(windows))]
pub async fn bundled_ai_download_and_extract(
    _app: AppHandle,
    _state: tauri::State<'_, BundledAiState>,
) -> Result<(), String> {
    Err(
        "Built-in AI download is available on Windows only. Install Ollama from https://ollama.com on this platform.".into(),
    )
}

#[cfg(not(windows))]
pub async fn bundled_ai_ensure_server(
    _app: AppHandle,
    _state: tauri::State<'_, BundledAiState>,
) -> Result<(), String> {
    Err("Built-in AI is available on Windows only.".into())
}

#[cfg(not(windows))]
pub async fn bundled_ai_stop_server(
    _state: tauri::State<'_, BundledAiState>,
) -> Result<(), String> {
    Ok(())
}

// ---- Windows ---------------------------------------------------------------

#[cfg(windows)]
pub fn bundled_ai_probe(app: &AppHandle) -> BundledAiProbe {
    let resource = resource_paths(app);
    let resource_runtime_ready = resource
        .as_ref()
        .map(|p| locate_ollama_exe(&p.runtime_dir).ok().flatten().is_some())
        .unwrap_or(false);
    let resource_has_model = resource
        .as_ref()
        .map(|p| has_any_model(&p.models_dir))
        .unwrap_or(false);

    let appdata = install_paths(app).ok();
    let appdata_runtime_ready = appdata
        .as_ref()
        .map(|p| locate_ollama_exe(&p.runtime_dir).ok().flatten().is_some())
        .unwrap_or(false);
    let appdata_has_model = appdata
        .as_ref()
        .map(|p| has_any_model(&p.models_dir))
        .unwrap_or(false);

    let install_root_display = resource
        .as_ref()
        .map(|p| p.install_root.display().to_string())
        .or_else(|| {
            appdata
                .as_ref()
                .map(|p| p.install_root.display().to_string())
        });

    BundledAiProbe {
        windows_embedding_supported: true,
        pinned_ollama_version: PINNED_VERSION,
        public_base_url: format!("http://{}:{}", BIND_HOSTPORT.0, BIND_HOSTPORT.1),
        install_root_display,
        runtime_ready: resource_runtime_ready || appdata_runtime_ready,
        runtime_from_installer: resource_runtime_ready,
        model_preinstalled: resource_has_model || appdata_has_model,
    }
}

/// Quick check for "does this folder hold at least one Ollama model blob?".
/// Ollama keeps blobs under ``models/blobs/sha256-…`` so the existence of that
/// subdirectory with any entry is a sufficient signal.
#[cfg(windows)]
fn has_any_model(models_dir: &Path) -> bool {
    let blobs = models_dir.join("blobs");
    let Ok(rd) = std::fs::read_dir(&blobs) else {
        return false;
    };
    rd.flatten().next().is_some()
}

/// Resolve the resource-shipped runtime + models folders (only present when the
/// developer ran ``scripts/prefetch-bundled-ai.ps1`` before ``build.bat``).
#[cfg(windows)]
fn resource_paths(app: &AppHandle) -> Option<InstallPaths> {
    let res = app.path().resource_dir().ok()?;
    let install_root = res.join("bundled-ai");
    if !install_root.exists() {
        return None;
    }
    let runtime_dir = install_root.join("runtime");
    let models_dir = install_root.join("models");
    Some(InstallPaths {
        install_root,
        runtime_dir,
        models_dir,
    })
}

/// Pick the best runtime + models directories: prefer the installer-shipped
/// resource folder when present, then fall back to the at-runtime download cache.
#[cfg(windows)]
fn resolve_paths(app: &AppHandle) -> Result<(PathBuf, PathBuf, bool), String> {
    if let Some(res) = resource_paths(app) {
        if locate_ollama_exe(&res.runtime_dir)?.is_some() {
            return Ok((res.runtime_dir, res.models_dir, true));
        }
    }
    let p = install_paths(app)?;
    Ok((p.runtime_dir, p.models_dir, false))
}

#[cfg(windows)]
fn github_zip_url() -> String {
    format!(
        "https://github.com/ollama/ollama/releases/download/{}/{}",
        PINNED_VERSION, WINDOWS_ZIP_FILENAME
    )
}

#[cfg(windows)]
fn install_paths(app: &AppHandle) -> Result<InstallPaths, String> {
    let install_root = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("bundled-ai");
    let runtime_dir = install_root.join("runtime");
    let models_dir = install_root.join("models");
    Ok(InstallPaths {
        install_root,
        runtime_dir,
        models_dir,
    })
}

#[cfg(windows)]
struct InstallPaths {
    install_root: PathBuf,
    runtime_dir: PathBuf,
    models_dir: PathBuf,
}

#[cfg(windows)]
#[derive(serde::Serialize, serde::Deserialize)]
struct Manifest {
    bundle_version: String,
}

#[cfg(windows)]
fn locate_ollama_exe(runtime_root: &Path) -> Result<Option<PathBuf>, String> {
    if !runtime_root.exists() {
        return Ok(None);
    }

    fn scan(dir: &Path, needle: &str) -> Option<PathBuf> {
        let rd = std::fs::read_dir(dir).ok()?;
        for ent in rd.flatten() {
            let p = ent.path();
            let name_os = ent.file_name();
            let name = name_os.to_string_lossy();
            if p.is_dir() {
                if let Some(found) = scan(&p, needle) {
                    return Some(found);
                }
            } else if name.eq_ignore_ascii_case(needle) {
                return Some(p);
            }
        }
        None
    }

    Ok(scan(runtime_root, "ollama.exe"))
}

#[cfg(windows)]
fn write_manifest(install_root: &Path, version: &str) -> Result<(), String> {
    let m = Manifest {
        bundle_version: version.to_owned(),
    };
    let txt = serde_json::to_vec_pretty(&m).map_err(|e| e.to_string())?;
    let p = install_root.join("manifest.json");
    std::fs::write(&p, &txt).map_err(|e| format!("{}", e))
}

#[cfg(windows)]
fn extract_zip_from_path(zip_path: &Path, dest_runtime: &Path) -> Result<(), String> {
    let rd = File::open(zip_path).map_err(|e| format!("open {:?}: {}", zip_path.display(), e))?;
    let mut archive = zip::ZipArchive::new(rd).map_err(|e| format!("zip archive: {}", e))?;

    let _ = std::fs::remove_dir_all(dest_runtime);
    std::fs::create_dir_all(dest_runtime).map_err(|e| format!("mkdir runtime: {}", e))?;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("zip entry {i}: {e}"))?;

        let Some(relative) = entry.enclosed_name() else {
            continue;
        };

        let outpath = dest_runtime.join(&relative);

        if entry.is_dir() || entry.name().ends_with('/') {
            std::fs::create_dir_all(&outpath).map_err(|e| format!("{}", e))?;
            continue;
        }

        if let Some(parent) = outpath.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("mkdir {:?}: {}", parent.display(), e))?;
        }

        let mut outfile =
            File::create(&outpath).map_err(|e| format!("create {:?}: {}", outpath.display(), e))?;
        io::copy(&mut entry, &mut outfile)
            .map_err(|e| format!("unpack {:?}: {}", outpath.display(), e))?;
    }

    Ok(())
}

#[cfg(windows)]
pub async fn bundled_ai_download_and_extract(
    app: AppHandle,
    state: tauri::State<'_, BundledAiState>,
) -> Result<(), String> {
    let _dl = state.download_mu.lock().await;

    emit(
        &app,
        BundledAiProgressPayload {
            phase: "starting",
            bytes_done: None,
            bytes_total: None,
            message: format!("Fetching Ollama {} …", PINNED_VERSION),
        },
    );

    let InstallPaths {
        install_root,
        runtime_dir,
        models_dir,
    } = install_paths(&app)?;

    std::fs::create_dir_all(&install_root).map_err(|e| format!("{}", e))?;
    std::fs::create_dir_all(&models_dir).map_err(|e| format!("{}", e))?;

    let zip_temp = install_root.join("ollama-bundle.partial.zip");
    let _ = tokio::fs::remove_file(&zip_temp).await;

    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(15))
        .timeout(Duration::from_secs(7200))
        .build()
        .map_err(|e| format!("http client: {}", e))?;

    let res = client
        .get(github_zip_url())
        .header(
            reqwest::header::USER_AGENT,
            "Scribble-Desktop bundled-ai downloader",
        )
        .send()
        .await
        .map_err(|e| format!("download failed: {}", e))?;

    let total = res.content_length();
    let status = res.status();
    if !status.is_success() {
        return Err(format!("download HTTP {}", status.as_u16()));
    }

    let mut stream = res.bytes_stream();

    emit(
        &app,
        BundledAiProgressPayload {
            phase: "download",
            bytes_done: Some(0),
            bytes_total: total,
            message: "Downloading bundled runtime… (large download)".into(),
        },
    );

    use futures_util::StreamExt;

    let mut outfile = tokio::fs::File::create(&zip_temp)
        .await
        .map_err(|e| format!("create tempfile: {}", e))?;

    let mut emitted: u64 = 0;
    let mut done: u64 = 0;

    while let Some(next) = stream.next().await {
        let chunk = next.map_err(|e| format!("chunk: {}", e))?;
        outfile
            .write_all(&chunk)
            .await
            .map_err(|e| format!("write zip: {}", e))?;
        done += chunk.len() as u64;

        let step = total.unwrap_or(done).max(1) / 128 + 1_048_576;
        if done.saturating_sub(emitted) >= step {
            emitted = done;
            emit(
                &app,
                BundledAiProgressPayload {
                    phase: "download",
                    bytes_done: Some(done),
                    bytes_total: total,
                    message: "Downloading bundled runtime…".into(),
                },
            );
        }
    }

    outfile.flush().await.map_err(|e| format!("{}", e))?;

    emit(
        &app,
        BundledAiProgressPayload {
            phase: "extract",
            bytes_done: None,
            bytes_total: total,
            message: "Extracting bundled runtime…".into(),
        },
    );

    let runtime_fs = runtime_dir.clone();
    let zip_path_fs = zip_temp.clone();

    tokio::task::spawn_blocking(move || extract_zip_from_path(&zip_path_fs, &runtime_fs))
        .await
        .map_err(|e| format!("{}", e))??;

    let _ = std::fs::remove_file(&zip_temp);

    if locate_ollama_exe(&runtime_dir)?.is_none() {
        return Err(
            "Extract did not yield ollama.exe — ZIP layout may have changed. Bump the pinned version.".into(),
        );
    }

    write_manifest(&install_root, PINNED_VERSION)?;

    emit(
        &app,
        BundledAiProgressPayload {
            phase: "done",
            bytes_done: Some(done),
            bytes_total: total,
            message: "Runtime ready.".into(),
        },
    );

    Ok(())
}

#[cfg(windows)]
fn emit(handle: &AppHandle, payload: BundledAiProgressPayload) {
    let _ = handle.emit("bundled-ai-progress", payload);
}

#[cfg(windows)]
async fn ping_ollama() -> bool {
    let Ok(client) = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
    else {
        return false;
    };
    match client
        .get(format!(
            "http://{}:{}/api/tags",
            BIND_HOSTPORT.0, BIND_HOSTPORT.1
        ))
        .send()
        .await
    {
        Ok(r) => r.status().is_success(),
        Err(_) => false,
    }
}

#[cfg(windows)]
pub async fn bundled_ai_ensure_server(
    app: AppHandle,
    state: tauri::State<'_, BundledAiState>,
) -> Result<(), String> {
    if ping_ollama().await {
        return Ok(());
    }

    let (runtime_dir, models_dir, _from_resources) = resolve_paths(&app)?;
    std::fs::create_dir_all(&models_dir).map_err(|e| format!("{}", e))?;

    let exe = locate_ollama_exe(&runtime_dir)?.ok_or_else(|| {
        "Built-in AI runtime missing. Reinstall Scribble or use the download fallback.".to_string()
    })?;

    let work_dir = exe
        .parent()
        .ok_or_else(|| "invalid ollama.exe path (no parent folder)".to_string())?
        .to_path_buf();

    {
        let mut g = state.server_child.lock().await;
        if let Some(mut ch) = g.take() {
            let _ = ch.kill().await;
            let _ = ch.wait().await;
        }
    }

    let mut cmd = tokio::process::Command::new(&exe);
    cmd.current_dir(&work_dir);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt as _;
        cmd.as_std_mut().creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    cmd.arg("serve");
    cmd.env(
        "OLLAMA_HOST",
        format!("{}:{}", BIND_HOSTPORT.0, BIND_HOSTPORT.1),
    );
    cmd.env(
        "OLLAMA_MODELS",
        models_dir.as_os_str().to_string_lossy().into_owned(),
    );
    cmd.env("OLLAMA_ORIGINS", SCRIBBLE_OLLAMA_ORIGINS);
    cmd.stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());

    let child = cmd
        .spawn()
        .map_err(|e| format!("spawn ollama serve: {}", e))?;

    {
        let mut g = state.server_child.lock().await;
        *g = Some(child);
    }

    for _ in 0..240 {
        if ping_ollama().await {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }

    let mut g = state.server_child.lock().await;
    if let Some(mut ch) = g.take() {
        let _ = ch.kill().await;
    }

    Err("Timed out waiting for bundled AI on port 11435.".into())
}

#[cfg(windows)]
pub async fn bundled_ai_stop_server(state: tauri::State<'_, BundledAiState>) -> Result<(), String> {
    state.shutdown_server().await;
    Ok(())
}
