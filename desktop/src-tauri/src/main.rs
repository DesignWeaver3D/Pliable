// Pliable desktop shell: starts the packaged geometry core, waits until it answers, then shows the app it
// serves in a native window. Portable: everything it writes goes in a `data` folder next to the program (in the user's data folder inside a Linux AppImage or a macOS app bundle).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::fs::{self, File};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use tauri::webview::DownloadEvent;
use tauri::{Manager, RunEvent, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

const HOST: &str = "127.0.0.1";
const PREFERRED_PORT: u16 = 8765; // a stable port keeps the page's saved settings (browser storage is per port)
const START_TIMEOUT: Duration = Duration::from_secs(180); // a frozen core can be slow on its first launch

struct Core(Mutex<Option<Child>>);

fn program_dir() -> PathBuf {
    let mut exe = std::env::current_exe().expect("cannot locate the program");
    if cfg!(target_os = "macos") {
        // a symlink to the program (say in /usr/local/bin) must still find the app bundle it points into
        exe = fs::canonicalize(&exe).unwrap_or(exe);
    }
    exe.parent().map(Path::to_path_buf).unwrap_or_default()
}

/// Whether the program runs from `Name.app/Contents/MacOS` (a macOS app bundle).
fn in_app_bundle(dir: &Path) -> bool {
    if !cfg!(target_os = "macos") {
        return false;
    }
    let contents = dir.parent();
    dir.file_name().is_some_and(|name| name == "MacOS")
        && contents.and_then(Path::file_name).is_some_and(|name| name == "Contents")
        && contents.and_then(Path::parent).and_then(Path::extension).is_some_and(|ext| ext == "app")
}

/// The frozen core: `core/pliable` next to the program (in `Contents/Resources` inside a macOS app bundle, where only
/// signed code may sit beside the program), or the path in PLIABLE_CORE (for development).
fn core_program(dir: &Path) -> PathBuf {
    if let Some(path) = std::env::var_os("PLIABLE_CORE") {
        return PathBuf::from(path);
    }
    let base = match dir.parent() {
        Some(contents) if in_app_bundle(dir) => contents.join("Resources"),
        _ => dir.to_path_buf(),
    };
    base.join("core").join(if cfg!(windows) { "pliable.exe" } else { "pliable" })
}

/// Where the program writes: a `data` folder next to it, except inside a Linux AppImage (its own folder is read-only
/// and goes away when the program ends), where it is `pliable` in the user's data folder, and inside a macOS app bundle
/// (which may run from a read-only copy), where it is `Pliable` in the user's Application Support folder.
fn data_root(dir: &Path) -> PathBuf {
    if in_app_bundle(dir) {
        if let Some(home) = std::env::var_os("HOME") {
            return PathBuf::from(home).join("Library").join("Application Support").join("Pliable");
        }
    }
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

/// Set in the page before it loads, where the shell saves the page's downloads: the page then waits for `report_download`
/// before it takes a file as saved (shellsave.ts).
#[cfg_attr(not(any(target_os = "linux", target_os = "macos")), allow(dead_code))]
const SHELL_SAVES_SCRIPT: &str = "window.__pliableShellSaves = true;";

/// Tell the page whether the download it started under `name` was written to the place the person chose.
#[cfg_attr(not(any(target_os = "linux", target_os = "macos")), allow(dead_code))]
fn report_download(webview: &tauri::Webview, name: &str, saved: bool) {
    let _ = webview.eval(&format!("window.__pliableDownloadSaved&&window.__pliableDownloadSaved({},{saved})", js_string(name)));
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
            let name = temp.file_name().and_then(|n| n.to_str()).unwrap_or_default().to_string();
            if !success {
                let _ = fs::remove_file(&temp);
                report_download(&webview, &name, false);
                return true;
            }
            let app = webview.app_handle().clone();
            let mut dialog = app.dialog().file();
            if !name.is_empty() {
                dialog = dialog.set_file_name(&name);
            }
            // The shell's own tests start the dialog in a folder of theirs, so they never write among a person's files.
            if let Some(folder) = std::env::var_os("PLIABLE_SAVE_DIR") {
                dialog = dialog.set_directory(folder);
            }
            dialog.save_file(move |chosen| {
                let mut saved = false;
                if let Some(target) = chosen.and_then(|p| p.into_path().ok()) {
                    match fs::copy(&temp, &target) {
                        Ok(_) => saved = true,
                        Err(e) => eprintln!("Cannot save {}: {e}", target.display()),
                    }
                }
                let _ = fs::remove_file(&temp);
                report_download(&webview, &name, saved);
            });
            true
        }
        _ => true,
    }
}

/// The page puts this before its title while the model has unsaved work (`UNSAVED_MARK` in the page's unsaved.ts).
const UNSAVED_MARK: &str = "\u{2022} ";

/// What the shell knows about leaving: whether the page reports unsaved work, whether the question is on screen,
/// and whether the person has already agreed to quit.
#[derive(Default)]
struct Leaving {
    unsaved: AtomicBool,
    asking: AtomicBool,
    agreed: AtomicBool,
}

/// Whether a page title says the model has unsaved work.
fn title_says_unsaved(title: &str) -> bool {
    title.starts_with(UNSAVED_MARK)
}

/// Whether closing or quitting must wait for the person's answer. When it must, the question is shown (once); agreeing quits.
fn must_ask_before_leaving(app: &tauri::AppHandle) -> bool {
    let leaving = app.state::<Leaving>();
    if leaving.agreed.load(Ordering::SeqCst) || !leaving.unsaved.load(Ordering::SeqCst) {
        return false;
    }
    if !leaving.asking.swap(true, Ordering::SeqCst) {
        let handle = app.clone();
        let mut question = app
            .dialog()
            .message("The model has changes that are not saved. Quit without saving?")
            .title("Pliable")
            .buttons(MessageDialogButtons::OkCancelCustom("Quit".into(), "Cancel".into()));
        // On the window itself: a question with no window was never shown when the program was not in front,
        // and then could not be asked again.
        if let Some(window) = app.get_webview_window("main") {
            question = question.parent(&window);
        }
        question.show(move |quit| {
            let leaving = handle.state::<Leaving>();
            leaving.asking.store(false, Ordering::SeqCst);
            if quit {
                leaving.agreed.store(true, Ordering::SeqCst);
                handle.exit(0);
            }
        });
    }
    true
}

/// On macOS the Quit menu item (and its shortcut) ends the program at once, with no event the shell could answer. It is
/// replaced by an item of the shell's own that asks the same question as closing the window.
#[cfg(target_os = "macos")]
fn ask_on_menu_quit(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem, MenuItemKind};
    const QUIT_ITEM: &str = "quit";
    let menu = Menu::default(app)?;
    if let Some(MenuItemKind::Submenu(first)) = menu.items()?.into_iter().next() {
        for item in first.items()? {
            if let MenuItemKind::Predefined(predefined) = &item {
                if predefined.text()?.starts_with("Quit") {
                    first.remove(predefined)?;
                }
            }
        }
        first.append(&MenuItem::with_id(app, QUIT_ITEM, "Quit Pliable", true, Some("CmdOrCtrl+Q"))?)?;
    }
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        if event.id() == QUIT_ITEM && !must_ask_before_leaving(app) {
            app.exit(0);
        }
    });
    Ok(())
}

/// Stop the core the shell started, if it is still running.
fn stop_core(handle: &tauri::AppHandle) {
    if let Some(mut child) = handle.state::<Core>().0.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

/// On a termination signal (SIGTERM, SIGINT, SIGHUP) stop the core and exit, since the process would otherwise end
/// without reaching the exit handling in `main`.
#[cfg(unix)]
fn stop_core_on_signal(handle: tauri::AppHandle) -> std::io::Result<()> {
    use signal_hook::consts::{SIGHUP, SIGINT, SIGTERM};
    let mut signals = signal_hook::iterator::Signals::new([SIGTERM, SIGINT, SIGHUP])?;
    std::thread::spawn(move || {
        if let Some(signal) = signals.forever().next() {
            stop_core(&handle);
            std::process::exit(128 + signal);
        }
    });
    Ok(())
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Core(Mutex::new(None)))
        .manage(Leaving::default())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            ask_on_menu_quit(app.handle())?;
            #[cfg(unix)]
            stop_core_on_signal(app.handle().clone())?;
            let dir = program_dir();
            let port = pick_port();
            let mut builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title(concat!("Pliable ", env!("CARGO_PKG_VERSION"), " (alpha)"))
                .inner_size(1440.0, 900.0)
                .min_inner_size(900.0, 600.0)
                .on_document_title_changed(|window, title| {
                    window.state::<Leaving>().unsaved.store(title_says_unsaved(&title), Ordering::SeqCst);
                });
            #[cfg(not(target_os = "macos"))]
            {
                builder = builder.data_directory(data_root(&dir).join("webview"));
            }
            #[cfg(any(target_os = "linux", target_os = "macos"))]
            {
                builder = builder.on_download(save_download).initialization_script(SHELL_SAVES_SCRIPT);
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

    app.run(|handle, event| match event {
        // Closing the window or quitting with unsaved work asks first.
        RunEvent::WindowEvent { event: WindowEvent::CloseRequested { api, .. }, .. } => {
            if must_ask_before_leaving(handle) {
                api.prevent_close();
            }
        }
        RunEvent::ExitRequested { api, .. } => {
            if must_ask_before_leaving(handle) {
                api.prevent_exit();
            }
        }
        RunEvent::Exit => {
            stop_core(handle);
        }
        _ => {}
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_bundle_is_recognized_only_on_macos() {
        let dir = Path::new("/Applications/Pliable.app/Contents/MacOS");
        assert_eq!(in_app_bundle(dir), cfg!(target_os = "macos"));
        let core = if cfg!(target_os = "macos") { "/Applications/Pliable.app/Contents/Resources/core" } else { "/Applications/Pliable.app/Contents/MacOS/core" };
        assert_eq!(core_program(dir).parent(), Some(Path::new(core)));
    }

    #[test]
    fn other_folders_are_not_app_bundles() {
        for dir in ["/opt/pliable", "/Applications/Pliable/Contents/MacOS", "/x/Pliable.app/Contents/Resources", "/x/Pliable.app/MacOS"] {
            assert!(!in_app_bundle(Path::new(dir)), "{dir}");
        }
    }

    #[test]
    fn the_title_mark_means_unsaved_work() {
        assert!(title_says_unsaved("\u{2022} Pliable"));
        assert!(!title_says_unsaved("Pliable"));
        assert!(!title_says_unsaved("Pliable \u{2022} "));
        assert!(!title_says_unsaved(""));
    }
}
