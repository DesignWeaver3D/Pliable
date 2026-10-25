// Pliable desktop shell: starts the packaged geometry core, waits until it answers, then shows the app it
// serves in a native window. Portable: everything it writes goes in a `data` folder next to the program.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::{self, File};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{Manager, RunEvent, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

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
    let data = dir.join("data");
    fs::create_dir_all(&data).map_err(|e| format!("Cannot create {}: {e}", data.display()))?;
    let log = File::create(data.join("core.log")).map_err(|e| format!("Cannot write the core log: {e}"))?;
    let log_err = log.try_clone().map_err(|e| e.to_string())?;
    let mut command = Command::new(&program);
    command
        .args(["--no-browser", "--host", HOST, "--port", &port.to_string()])
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
                show_error(&window, &format!("The geometry core stopped before it was ready ({status}). See data/core.log next to the program."));
                return;
            }
            if started.elapsed() > START_TIMEOUT {
                show_error(&window, "The geometry core did not start in time. See data/core.log next to the program.");
                return;
            }
            std::thread::sleep(Duration::from_millis(250));
        }
    });
}

fn main() {
    let app = tauri::Builder::default()
        .manage(Core(Mutex::new(None)))
        .setup(|app| {
            let dir = program_dir();
            let port = pick_port();
            let mut builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Pliable")
                .inner_size(1440.0, 900.0)
                .min_inner_size(900.0, 600.0);
            #[cfg(not(target_os = "macos"))]
            {
                builder = builder.data_directory(dir.join("data").join("webview"));
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
