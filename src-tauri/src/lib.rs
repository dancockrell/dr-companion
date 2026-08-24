use tauri::{Manager, WebviewWindow};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {} — DR Companion shell ready.", name)
}

#[tauri::command]
fn bridge_default_url() -> String {
    "ws://127.0.0.1:7415/companion".into()
}

#[tauri::command]
fn set_always_on_top(window: WebviewWindow, value: bool) -> Result<(), String> {
    window
        .set_always_on_top(value)
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            greet,
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
