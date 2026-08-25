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

/// The map, in a window of its own.
///
/// The panel is only as wide as the player has given us, which is usually right
/// for vitals and buttons and wrong for a map you are meant to *watch*.
/// Players know where the hazards are —
/// the rooms that break scripts — and watching for them means keeping the map
/// visible while doing something else. That wants a second window, not a
/// taller panel.
///
/// Focused rather than duplicated when it already exists, so pressing the
/// button twice does not leave two maps open.
#[tauri::command]
fn open_map_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window("map") {
        let _ = existing.unminimize();
        let _ = existing.show();
        return existing.set_focus().map_err(|e| e.to_string());
    }

    // `?view=map` rather than a route path, so it behaves the same under the
    // dev server and from the bundled index.html, where a path would 404.
    tauri::WebviewWindowBuilder::new(
        &app,
        "map",
        tauri::WebviewUrl::App("index.html?view=map".into()),
    )
    .title("DR Companion — Map")
    .inner_size(900.0, 760.0)
    .min_inner_size(420.0, 360.0)
    .resizable(true)
    .build()
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// Put it back. Closing the window by hand is the same decision, so the panel
/// shows the map inline again either way.
#[tauri::command]
fn close_map_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("map") {
        w.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Whether the map is currently popped out.
///
/// Asked rather than remembered: the panel and the map window are separate
/// webviews with separate state, so the panel cannot know from its own memory
/// whether a window it opened is still there or the user closed it by hand.
#[tauri::command]
fn map_window_open(app: tauri::AppHandle) -> bool {
    app.get_webview_window("map").is_some()
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
            set_always_on_top,
            open_map_window,
            close_map_window,
            map_window_open
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
