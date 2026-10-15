// Hides the console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Serialize)]
struct Loaded {
    /// The saved JSON, if any.
    data: Option<String>,
    /// True for the sample-data demo build.
    demo: bool,
    /// True when `data` was copied from the old Mac (Swift) app on first launch.
    migrated: bool,
    /// Where the data file lives, for display in Settings.
    path: String,
}

fn is_demo(app: &AppHandle) -> bool {
    app.config().identifier.ends_with(".demo")
}

fn data_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("data.json"))
}

/// App IDs used by earlier builds. Their data folder sits next to the current one on every OS
/// (e.g. ~/Library/Application Support/<id> on macOS, %APPDATA%\<id> on Windows, ~/.local/share/<id> on Linux).
const PREVIOUS_IDS: &[&str] = &["local.pointtracker.app"];

/// Data saved under an earlier app ID, used once to carry existing records over.
fn previous_id_data(app: &AppHandle) -> Option<String> {
    let current = app.path().app_data_dir().ok()?;
    let parent = current.parent()?;
    PREVIOUS_IDS.iter().find_map(|id| fs::read_to_string(parent.join(id).join("data.json")).ok())
}

/// The old Mac (Swift) app's data file, used once to carry existing records over.
#[cfg(target_os = "macos")]
fn legacy_swift_data() -> Option<String> {
    let home = std::env::var_os("HOME")?;
    let path = PathBuf::from(home).join("Library/Application Support/PointTracker/data.json");
    fs::read_to_string(path).ok()
}

/// The Swift app only ever existed on macOS.
#[cfg(not(target_os = "macos"))]
fn legacy_swift_data() -> Option<String> {
    None
}

#[tauri::command]
fn load_data(app: AppHandle) -> Result<Loaded, String> {
    let demo = is_demo(&app);
    let path = data_path(&app)?;
    let shown = path.display().to_string();
    if let Ok(s) = fs::read_to_string(&path) {
        // Keep a copy of what was there at launch.
        let _ = fs::write(path.with_file_name("data.previous.json"), &s);
        return Ok(Loaded { data: Some(s), demo, migrated: false, path: shown });
    }
    if !demo {
        if let Some(s) = previous_id_data(&app).or_else(legacy_swift_data) {
            return Ok(Loaded { data: Some(s), demo, migrated: true, path: shown });
        }
    }
    Ok(Loaded { data: None, demo, migrated: false, path: shown })
}

#[tauri::command]
fn save_data(app: AppHandle, json: String) -> Result<(), String> {
    let path = data_path(&app)?;
    // Write to a temp file first so a crash mid-save never leaves a half-written file.
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, json).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

// ---------- Attachments (screenshots, reprimand documents) ----------
// Files are copied into <app data>/attachments/ under a generated name; data.json stores that name.

#[derive(Serialize)]
struct Attachment {
    /// Stored file name inside the attachments folder.
    file: String,
    /// Original file name, for display.
    name: String,
    /// "image" or "pdf".
    kind: String,
}

fn attachments_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("attachments");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Only plain file names inside the attachments folder (no paths).
fn attachment_path(app: &AppHandle, file: &str) -> Result<PathBuf, String> {
    if file.is_empty() || file.contains(['/', '\\']) || file.contains("..") {
        return Err("Invalid attachment name".into());
    }
    Ok(attachments_dir(app)?.join(file))
}

fn kind_for(ext: &str) -> Option<&'static str> {
    match ext {
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "heic" => Some("image"),
        "pdf" => Some("pdf"),
        _ => None,
    }
}

fn unique_name(ext: &str) -> String {
    use std::sync::atomic::{AtomicU32, Ordering};
    static COUNTER: AtomicU32 = AtomicU32::new(0);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{nanos:x}-{}.{ext}", COUNTER.fetch_add(1, Ordering::Relaxed))
}

/// Copies a file the user picked (or dropped) into the attachments folder.
#[tauri::command]
fn import_attachment(app: AppHandle, path: String, allow_pdf: bool) -> Result<Attachment, String> {
    let src = PathBuf::from(&path);
    let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    let kind = kind_for(&ext).ok_or("Only images (PNG, JPG, GIF, WebP, BMP, HEIC) and PDFs can be attached.")?;
    if kind == "pdf" && !allow_pdf {
        return Err("Only images can be attached here.".into());
    }
    let file = unique_name(&ext);
    fs::copy(&src, attachments_dir(&app)?.join(&file)).map_err(|e| e.to_string())?;
    let name = src.file_name().and_then(|n| n.to_str()).unwrap_or(&file).to_string();
    Ok(Attachment { file, name, kind: kind.into() })
}

/// Saves a pasted image (base64 PNG) into the attachments folder.
#[tauri::command]
fn save_attachment_bytes(app: AppHandle, name: String, data_base64: String) -> Result<Attachment, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD.decode(data_base64).map_err(|e| e.to_string())?;
    let file = unique_name("png");
    fs::write(attachments_dir(&app)?.join(&file), bytes).map_err(|e| e.to_string())?;
    Ok(Attachment { file, name, kind: "image".into() })
}

/// File contents as base64, for thumbnails.
#[tauri::command]
fn read_attachment(app: AppHandle, file: String) -> Result<String, String> {
    use base64::Engine;
    let bytes = fs::read(attachment_path(&app, &file)?).map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

/// Opens an attachment in the system's default viewer.
#[tauri::command]
fn open_attachment(app: AppHandle, file: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let path = attachment_path(&app, &file)?;
    app.opener().open_path(path.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_attachment(app: AppHandle, file: String) -> Result<(), String> {
    let path = attachment_path(&app, &file)?;
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Every attachment file name referenced by entries and reprimands.
fn referenced_files(data: &serde_json::Value) -> Vec<String> {
    let mut files = Vec::new();
    for list in ["entries", "reprimands"] {
        for item in data[list].as_array().into_iter().flatten() {
            for att in item["attachments"].as_array().into_iter().flatten() {
                if let Some(f) = att["file"].as_str() {
                    files.push(f.to_string());
                }
            }
        }
    }
    files
}

/// Writes a backup that also carries the attachment files (base64), so it's complete on its own.
#[tauri::command]
fn export_backup(app: AppHandle, path: String, json: String) -> Result<(), String> {
    use base64::Engine;
    let mut data: serde_json::Value = serde_json::from_str(&json).map_err(|e| e.to_string())?;
    let mut files = serde_json::Map::new();
    for file in referenced_files(&data) {
        if let Ok(bytes) = fs::read(attachment_path(&app, &file)?) {
            files.insert(file, base64::engine::general_purpose::STANDARD.encode(bytes).into());
        }
    }
    data["attachmentFiles"] = files.into();
    let out = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    fs::write(path, out).map_err(|e| e.to_string())
}

/// Reads a backup, restores any attachment files it carries, and returns the data JSON.
#[tauri::command]
fn import_backup(app: AppHandle, path: String) -> Result<String, String> {
    use base64::Engine;
    let text = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let mut data: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    if let Some(files) = data.get("attachmentFiles").and_then(|f| f.as_object()) {
        for (file, b64) in files {
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(b64.as_str().unwrap_or(""))
                .map_err(|e| e.to_string())?;
            fs::write(attachment_path(&app, file)?, bytes).map_err(|e| e.to_string())?;
        }
    }
    if let Some(obj) = data.as_object_mut() {
        obj.remove("attachmentFiles");
    }
    serde_json::to_string(&data).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    fs::write(path, contents).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| e.to_string())
}

/// Build number (YYMMDDHHmm, local time), stamped automatically by scripts/build.mjs on every build.
/// The version comes from tauri.conf.json and only changes deliberately.
const BUILD_NUMBER: &str = match option_env!("PT_BUILD_NUMBER") {
    Some(b) => b,
    None => "dev",
};
const COPYRIGHT: &str = "Copyright © 2026 CRaysball Softworks. All rights reserved.";

#[derive(Serialize)]
struct AppInfo {
    name: String,
    version: String,
    build: String,
    copyright: String,
}

/// Name, version, build number and copyright for the in-app About window.
#[tauri::command]
fn app_info(app: AppHandle) -> AppInfo {
    let info = app.package_info();
    AppInfo {
        name: info.name.clone(),
        version: info.version.to_string(),
        build: BUILD_NUMBER.into(),
        copyright: COPYRIGHT.into(),
    }
}

/// The platform's standard menu bar, plus File → Save (⌘S on macOS, Ctrl+S on Windows/Linux)
/// and an About item with the version, build number and copyright.
fn build_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::default(app)?;
    let submenus: Vec<Submenu<tauri::Wry>> =
        menu.items()?.into_iter().filter_map(|item| item.as_submenu().cloned()).collect();

    // About opens the app's own About window (the system one can't show a larger icon).
    // It replaces the default About in the app menu on macOS and goes under Help elsewhere.
    let about = MenuItem::with_id(app, "about", format!("About {}", app.package_info().name), true, None::<&str>)?;
    if cfg!(target_os = "macos") {
        if let Some(app_menu) = submenus.first() {
            app_menu.remove_at(0)?;
            app_menu.insert(&about, 0)?;
        }
    } else if let Some(help) = submenus.iter().find(|s| s.text().map(|t| t == "Help").unwrap_or(false)) {
        help.append(&about)?;
    } else {
        menu.append(&Submenu::with_items(app, "Help", true, &[&about])?)?;
    }

    let save = MenuItem::with_id(app, "save", "Save", true, Some("CmdOrCtrl+S"))?;
    let file = submenus.into_iter().find(|sub| sub.text().map(|t| t == "File").unwrap_or(false));
    match file {
        Some(file) => {
            file.insert(&save, 0)?;
            file.insert(&PredefinedMenuItem::separator(app)?, 1)?;
        }
        None => {
            // No File menu on this platform's default: add one after the app menu (macOS) or first (others).
            let file = Submenu::with_items(app, "File", true, &[&save])?;
            menu.insert(&file, if cfg!(target_os = "macos") { 1 } else { 0 })?;
        }
    }
    Ok(menu)
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let menu = build_menu(app.handle())?;
            app.set_menu(menu)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            match event.id().as_ref() {
                "save" => { let _ = app.emit("menu-save", ()); }
                "about" => { let _ = app.emit("menu-about", ()); }
                _ => {}
            }
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            load_data, save_data, write_text_file, read_text_file, app_info,
            import_attachment, save_attachment_bytes, read_attachment, open_attachment, delete_attachment,
            export_backup, import_backup
        ])
        .run(tauri::generate_context!())
        .expect("error while running Point Tracker");
}
