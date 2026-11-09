// Pliable desktop shell: starts the packaged geometry core, waits until it answers, then shows the app it
// serves in a native window. Portable: everything it writes goes in a `data` folder next to the program (in the user's data folder inside a Linux AppImage).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::fs::{self, File};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use tauri::webview::DownloadEvent;
use tauri::{Manager, RunEvent, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;

const HOST: &str = "127.0.0.1";
const PREFERRED_PORT: u16 = 8765; // a stable port keeps the page's saved settings (browser storage is per port)
const START_TIMEOUT: Duration = Duration::from_secs(180); // a frozen core can be slow on its first launch

struct Core(Mutex<Option<Child>>);

fn program_dir() -> PathBuf {
    let exe = std::env::current_exe().expect("cannot locate the program");
    exe.parent().map(Path::to_path_buf).unwrap_or_default()
}

/// The frozen core: `core/pliable` next to the program, or the path in PLIABLE_CORE (for development).
fn core_program(dir: &Path) -> PathBuf {
    if let Some(path) = std::env::var_os("PLIABLE_CORE") {
        return PathBuf::from(path);
    }
    dir.join("core").join(if cfg!(windows) { "pliable.exe" } else { "pliable" })
}

/// Where the program writes: a `data` folder next to it, except inside a Linux AppImage (its own folder is read-only
/// and goes away when the program ends), where it is `pliable` in the user's data folder.
fn data_root(dir: &Path) -> PathBuf {
    if std::env::var_os("APPIMAGE").is_some() {
        let base = std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local").join("share")));
        if let Some(base) = base {
            return base.join("pliable");
        }
    }
    dir.join("data")
}

fn pick_port() -> u16 {
    // PLIABLE_PORT fixes the port (the packaged-app smoke test needs to know it)
    if let Some(port) = std::env::var("PLIABLE_PORT").ok().and_then(|text| text.parse().ok()) {
        return port;
    }
    for candidate in [PREFERRED_PORT, 0] {
        if let Ok(listener) = TcpListener::bind((HOST, candidate)) {
            if let Ok(addr) = listener.local_addr() {
                return addr.port();
            }
        }
    }
    PREFERRED_PORT
}

fn start_core(dir: &Path, port: u16) -> Result<Child, String> {
    let program = core_program(dir);
    if !program.is_file() {
        return Err(format!("The geometry core was not found at {}.", program.display()));
    }
    let data = data_root(dir);
    fs::create_dir_all(&data).map_err(|e| format!("Cannot create {}: {e}", data.display()))?;
    let log = File::create(data.join("core.log")).map_err(|e| format!("Cannot write the core log: {e}"))?;
    let log_err = log.try_clone().map_err(|e| e.to_string())?;
    let mut command = Command::new(&program);
    command
        .args(["--no-browser", "--host", HOST, "--port", &port.to_string()])
        .env("PLIABLE_SHELL", env!("CARGO_PKG_VERSION")) // the diagnostics report says it runs in the desktop window
        .env("PLIABLE_DATA", data.join("core")) // autosave and other saved files stay with the portable folder
        .current_dir(program.parent().unwrap_or(dir))
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(log_err));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: the core's console stays hidden
    }
    command.spawn().map_err(|e| format!("Cannot start the geometry core: {e}"))
}

fn show_error(window: &WebviewWindow, message: &str) {
    let text = js_string(message);
    let _ = window.eval(&format!(
        "var m=document.getElementById('msg');if(m){{m.className='error';m.textContent={text};}}"
    ));
}

/// A JavaScript string literal for `message`.
fn js_string(message: &str) -> String {
    let mut out = String::from("\"");
    for c in message.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => {}
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// Wait for the core to accept connections, then load its page; report a core that exits or never starts.
fn open_when_ready(app: tauri::AppHandle, window: WebviewWindow, port: u16) {
    std::thread::spawn(move || {
        let address: SocketAddr = format!("{HOST}:{port}").parse().expect("valid address");
        let started = Instant::now();
        loop {
            if TcpStream::connect_timeout(&address, Duration::from_millis(300)).is_ok() {
                let url = Url::parse(&format!("http://{HOST}:{port}/")).expect("valid url");
                if let Err(e) = window.navigate(url) {
                    show_error(&window, &format!("Cannot open the app: {e}"));
                }
                return;
            }
            let core = app.state::<Core>();
            let exited = match core.0.lock().unwrap().as_mut() {
                Some(child) => child.try_wait().ok().flatten().map(|status| status.to_string()),
                None => Some("not started".into()),
            };
            if let Some(status) = exited {
                show_error(&window, &format!("The geometry core stopped before it was ready ({status}). See core.log in the data folder."));
                return;
            }
            if started.elapsed() > START_TIMEOUT {
                show_error(&window, "The geometry core did not start in time. See core.log in the data folder.");
                return;
            }
            std::thread::sleep(Duration::from_millis(250));
        }
    });
}

/// Temporary files of downloads in progress, by download address (macOS does not say where a finished download went).
fn pending_downloads() -> &'static Mutex<HashMap<String, PathBuf>> {
    static PENDING: OnceLock<Mutex<HashMap<String, PathBuf>>> = OnceLock::new();
    PENDING.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Saving a file from the page is a download. The Linux and macOS windows drop downloads that have no handler, so each
/// one goes to a temporary file first and, when it has arrived, a Save As dialog asks where to keep it (cancelling discards it).
#[cfg_attr(not(any(target_os = "linux", target_os = "macos")), allow(dead_code))]
fn save_download(webview: tauri::Webview, event: DownloadEvent<'_>) -> bool {
    match event {
        DownloadEvent::Requested { url, destination } => {
            let name = destination.file_name().map(|n| n.to_os_string()).unwrap_or_else(|| "pliable-file".into());
            *destination = std::env::temp_dir().join("pliable-downloads").join(name);
            if let Some(folder) = destination.parent() {
                let _ = fs::create_dir_all(folder);
            }
            pending_downloads().lock().unwrap().insert(url.to_string(), destination.clone());
            true
        }
        DownloadEvent::Finished { url, path, success } => {
            let remembered = pending_downloads().lock().unwrap().remove(url.as_str());
            let Some(temp) = path.or(remembered) else { return true };
            if !success {
                let _ = fs::remove_file(&temp);
                return true;
            }
            let app = webview.app_handle().clone();
            let mut dialog = app.dialog().file();
            if let Some(name) = temp.file_name().and_then(|n| n.to_str()) {
                dialog = dialog.set_file_name(name);
            }
            dialog.save_file(move |chosen| {
                if let Some(target) = chosen.and_then(|p| p.into_path().ok()) {
                    if let Err(e) = fs::copy(&temp, &target) {
                        eprintln!("Cannot save {}: {e}", target.display());
                    }
                }
                let _ = fs::remove_file(&temp);
            });
            true
        }
        _ => true,
    }
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Core(Mutex::new(None)))
        .setup(|app| {
            let dir = program_dir();
            let port = pick_port();
            let mut builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title(concat!("Pliable ", env!("CARGO_PKG_VERSION"), " (alpha)"))
                .inner_size(1440.0, 900.0)
                .min_inner_size(900.0, 600.0);
            #[cfg(not(target_os = "macos"))]
            {
                builder = builder.data_directory(data_root(&dir).join("webview"));
            }
            #[cfg(any(target_os = "linux", target_os = "macos"))]
            {
                builder = builder.on_download(save_download);
            }
            let window = builder.build()?;
            match start_core(&dir, port) {
                Ok(child) => {
                    *app.state::<Core>().0.lock().unwrap() = Some(child);
                    open_when_ready(app.handle().clone(), window, port);
                }
                Err(message) => show_error(&window, &message),
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the Pliable shell");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            if let Some(mut child) = handle.state::<Core>().0.lock().unwrap().take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    });
}
