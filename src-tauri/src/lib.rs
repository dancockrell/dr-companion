pub mod setup;

use tauri::{Manager, WebviewWindow};

#[tauri::command]
fn bridge_default_url() -> String {
    "ws://127.0.0.1:7415/companion".into()
}

#[tauri::command]
fn set_always_on_top(window: WebviewWindow, value: bool) -> Result<(), String> {
    window.set_always_on_top(value).map_err(|e| e.to_string())
}

/// Where the app keeps anything it installed, so the UI can show it and the
/// user can delete it without hunting.
#[tauri::command]
fn app_data_path() -> String {
    setup::app_data_dir().to_string_lossy().into_owned()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            setup::plan_setup,
            setup::download_component,
            setup::extract_lich,
            setup::extract_archive,
            setup::install_bundle,
            setup::install_bridge_script,
            setup::reveal_file,
            setup::run_installer,
            app_data_path,
            bridge_default_url,
            set_always_on_top
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_title("DR Companion");
                let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
                    width: 520.0,
                    height: 780.0,
                }));
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running DR Companion");
}
