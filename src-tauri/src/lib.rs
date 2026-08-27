pub mod config_import;
pub mod game_link;
pub mod lich;
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

/// Any panel, in a window of its own.
///
/// This was three map-specific commands until it became clear the map is not a
/// special case, just the first one anybody wanted. Two people will not agree
/// on what belongs on the main window: somebody watching for hazards wants the
/// map parked on a second monitor, somebody crafting wants inventory there, and
/// somebody running four accounts wants the script watchdog and nothing else.
///
/// Window labels are `panel-<id>`, which keeps them distinct per panel and lets
/// a lookup answer "is this one already out" without any bookkeeping on our
/// side.
fn panel_label(id: &str) -> String {
    format!("panel-{id}")
}

/// Reject anything that is not a plain panel id before it reaches a URL.
///
/// The id arrives from the web view and is interpolated into a query string, so
/// it does not get to contain punctuation. Nothing legitimate needs to.
fn valid_panel_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 32 && id.chars().all(|c| c.is_ascii_lowercase() || c == '_')
}

/// Focused rather than duplicated when it already exists, so pressing the
/// button twice does not leave two of the same window open.
#[tauri::command]
fn open_panel_window(app: tauri::AppHandle, id: String, title: String) -> Result<(), String> {
    if !valid_panel_id(&id) {
        return Err(format!("not a panel id: {id}"));
    }

    if let Some(existing) = app.get_webview_window(&panel_label(&id)) {
        let _ = existing.unminimize();
        let _ = existing.show();
        return existing.set_focus().map_err(|e| e.to_string());
    }

    // A query parameter rather than a route path, so it behaves the same under
    // the dev server and from the bundled index.html, where a path would 404.
    tauri::WebviewWindowBuilder::new(
        &app,
        panel_label(&id),
        tauri::WebviewUrl::App(format!("index.html?view=panel&id={id}").into()),
    )
    .title(format!("DR Companion — {title}"))
    .inner_size(760.0, 640.0)
    .min_inner_size(320.0, 240.0)
    .resizable(true)
    .build()
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// Put it back. Closing the window by hand is the same decision, so the panel
/// returns to the stack either way.
#[tauri::command]
fn close_panel_window(app: tauri::AppHandle, id: String) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(&panel_label(&id)) {
        w.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Which panels are currently in windows of their own.
///
/// Asked rather than remembered: each window is a separate webview with its own
/// state, so the dashboard cannot know from its own memory whether a window it
/// opened is still there or the player closed it by hand.
#[tauri::command]
fn panel_windows(app: tauri::AppHandle) -> Vec<String> {
    app.webview_windows()
        .keys()
        .filter_map(|label| label.strip_prefix("panel-").map(str::to_string))
        .collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            config_import::read_genie_config,
            game_link::game_status,
            game_link::game_attach,
            game_link::game_send,
            game_link::game_detach,
            lich::lich_status,
            lich::launch_lich,
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
            open_panel_window,
            close_panel_window,
            panel_windows
        ])
        .manage(game_link::GameLink::default())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_title("DR Companion");

                // Wide enough for the layout it actually has.
                //
                // It opened at 520 wide, from when this was one narrow column
                // docked beside the game. It is three columns now - map,
                // dashboard, room - and at 520 the third is entirely off the
                // right edge, the character panel is a sliver reading "Health"
                // and "Stamina" with no numbers, and the chat cannot be seen at
                // all. The first thing anyone saw on opening the app was a
                // broken one.
                //
                // 1180 is the map column at its 300 default, the dashboard at
                // its 420, the two dividers, and enough left for the room
                // column to be worth having. Anyone who wants it narrow can
                // drag it narrow - the columns are theirs to set. The point is
                // that the default is not a shape the app cannot render.
                let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
                    width: 1180.0,
                    height: 820.0,
                }));

                // Below this the layout stops being able to show its own
                // content rather than merely being cramped. Nothing prevents
                // resizing above it.
                let _ = window.set_min_size(Some(tauri::Size::Logical(tauri::LogicalSize {
                    width: 720.0,
                    height: 480.0,
                })));
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running DR Companion");
}
