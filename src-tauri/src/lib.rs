pub mod bridge_token;
pub mod config_import;
pub mod credentials;
pub mod custom_portraits;
pub mod eaccess;
pub mod elanthipedia;
pub mod game_link;
pub mod lich;
pub mod lich_health;
pub mod media_keys;
pub mod music;
pub mod node;
pub mod pause;
pub mod presentation_bridge;
pub mod python;
pub mod sal;
pub mod script_api;
pub mod scripts;
pub mod setup;
pub mod sounds;
pub mod viewer;
pub mod window_size;

use tauri::{Emitter, Manager, WebviewWindow, WindowEvent};

/// The bridge address to try before the user has configured anything.
/// Constant today because the port is fixed; a command rather than a literal
/// in the frontend so the two sides can't drift if that changes.
#[tauri::command]
fn bridge_default_url() -> String {
    "ws://127.0.0.1:7415/companion".into()
}

/// Pin or unpin the main window above others. Never errors in practice on
/// the platforms this ships for; `Result` only because the underlying
/// windowing call can fail.
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
///
/// `async` is load-bearing, not style. A synchronous `#[tauri::command]` runs
/// on the main thread, which is the event loop's thread; building a webview
/// window dispatches the creation onto that loop and then blocks waiting for
/// the answer, so the loop can never deliver it. Measured on the packaged
/// build (issue #419): the window and its WebView2 were created, `build()`
/// never returned, the navigation to `index.html?view=panel&id=…` was
/// therefore never issued, and the pop-out sat on `about:blank` — a white
/// window, forever, with the invoke promise still pending 67 seconds later and
/// no error anywhere for the frontend to show. An `async` command runs on the
/// async runtime instead, so the dispatch has a live event loop to answer it.
///
/// Every window operation below is dispatched the same way, `set_focus` and
/// `close` included, so `close_panel_window` is `async` for the same reason.
#[tauri::command]
async fn open_panel_window(app: tauri::AppHandle, id: String, title: String) -> Result<(), String> {
    if !valid_panel_id(&id) {
        return Err(format!("not a panel id: {id}"));
    }

    if let Some(existing) = app.get_webview_window(&panel_label(&id)) {
        let _ = existing.unminimize();
        let _ = existing.show();
        existing.set_focus().map_err(|e| e.to_string())?;
        let _ = app.emit(
            "panel-window:lifecycle",
            serde_json::json!({ "id": id, "state": "open" }),
        );
        return Ok(());
    }

    // A query parameter rather than a route path, so it behaves the same under
    // the dev server and from the bundled index.html, where a path would 404.
    let window = tauri::WebviewWindowBuilder::new(
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

    let event_app = app.clone();
    let event_id = id.clone();
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Destroyed) {
            let _ = event_app.emit(
                "panel-window:lifecycle",
                serde_json::json!({ "id": event_id, "state": "closed" }),
            );
        }
    });
    let _ = app.emit(
        "panel-window:lifecycle",
        serde_json::json!({ "id": id, "state": "open" }),
    );

    Ok(())
}

/// Put it back. Closing the window by hand is the same decision, so the panel
/// returns to the stack either way.
///
/// `async` for the reason written out on `open_panel_window`: `close()` is
/// dispatched to the event loop like every other window operation, and a
/// synchronous command is already sitting on that loop.
#[tauri::command]
async fn close_panel_window(app: tauri::AppHandle, id: String) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(&panel_label(&id)) {
        let _ = app.emit(
            "panel-window:lifecycle",
            serde_json::json!({ "id": id, "state": "closing" }),
        );
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
            bridge_token::read_bridge_token,
            config_import::read_genie_config,
            config_import::write_genie_config,
            config_import::restore_genie_config,
            custom_portraits::save_custom_portrait,
            custom_portraits::read_custom_portrait,
            custom_portraits::remove_custom_portrait,
            elanthipedia::fetch_elanthipedia,
            sounds::read_sound,
            sounds::list_sounds,
            media_keys::send_media_key,
            game_link::game_status,
            game_link::game_attach,
            game_link::game_send,
            game_link::game_detach,
            game_link::game_backlog,
            lich::lich_status,
            lich::genie_status,
            lich::launch_lich,
            lich_health::lich_health,
            setup::plan_setup,
            setup::downloads::download_component,
            music::music_library_status,
            music::install_music_library,
            music::cancel_music_install,
            music::remove_music_group,
            setup::install_bundled_ruby4lich5,
            setup::extract_archive,
            setup::bundles::install_bundle,
            setup::install_bridge_script,
            setup::reveal_file,
            setup::run_installer,
            app_data_path,
            bridge_default_url,
            set_always_on_top,
            open_panel_window,
            close_panel_window,
            panel_windows,
            script_api::script_api_info,
            presentation_bridge::publish_world_snapshot,
            presentation_bridge::publish_presentation_event,
            presentation_bridge::presentation_bridge_info,
            viewer::viewer_status,
            viewer::launch_viewer,
            pause::set_paused,
            pause::is_paused,
            python::python_status,
            python::run_python_task,
            python::stop_python_task,
            python::python_task_state,
            node::node_status,
            node::run_node_task,
            node::stop_node_task,
            node::node_task_state,
            scripts::script_dirs,
            scripts::list_scripts,
            scripts::read_script,
            scripts::write_script,
            scripts::delete_script,
            scripts::script_template
        ])
        .manage(game_link::GameLink::default())
        .manage(pause::Pause::default())
        .manage(python::PythonTasks::default())
        .manage(node::NodeTasks::default())
        .manage(viewer::ViewerProcess::default())
        .setup(|app| {
            // The optional music library lives in the app data directory, so
            // the asset protocol has to be told about that one directory
            // before a track there can be played. Granted from `music_dir()`
            // itself rather than a path repeated in tauri.conf.json, so the
            // scope cannot name somewhere the installer does not write.
            if let Err(e) = app
                .asset_protocol_scope()
                .allow_directory(music::music_dir(), true)
            {
                eprintln!("warning: music library directory is not readable: {e}");
            }

            // The Python scripting socket. Started here rather than lazily on
            // first use, so a script waiting for the app to open does not
            // also have to guess whether it has finished starting - the token
            // and port files exist by the time the window does.
            if let Err(e) = script_api::start(app.handle().clone()) {
                // Not fatal: the rest of the app works without it, and a
                // player who never scripts should not lose the client over a
                // port bind failure.
                eprintln!("warning: script API did not start: {e}");
            }

            // The Godot presentation bridge - same non-fatal treatment as the
            // script API above. The 3D viewer is an optional presentation
            // layer (see docs/CLAUDE_3D_VIEWER_BRIEF.md: "the client remains
            // usable if Godot is absent/crashed"), never something a bind
            // failure should take the rest of the app down over.
            if let Err(e) = presentation_bridge::start(app.handle().clone()) {
                eprintln!("warning: presentation bridge did not start: {e}");
            }

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
                //
                // Asked for, not imposed. On the clean-VM first run this set
                // 1180x820 on a 1024x768 display and Windows did not shrink
                // it: 224 px hung off the right edge, 91 px off the bottom,
                // and the setup wizard's own "Check again" button was among
                // the controls a user could not reach
                // (docs/verification/first-run-2026-09-05.md, Defect 1). So
                // the size goes past the work area first, and the arithmetic
                // for that lives in `window_size` where it can be tested -
                // this screen is not one this machine can produce.
                //
                // Below the minimum the layout stops being able to show its
                // own content rather than merely being cramped. Nothing
                // prevents resizing above it.
                const REQUESTED: (f64, f64) = (1180.0, 820.0);
                const MIN: (f64, f64) = (720.0, 480.0);
                const MARGIN: f64 = 24.0;

                let _ = window.set_min_size(Some(tauri::Size::Logical(tauri::LogicalSize {
                    width: MIN.0,
                    height: MIN.1,
                })));

                // The monitor the window is already on, falling back to the
                // primary. `current_monitor` is the one that answers "which
                // screen is this actually opening on" when there are several,
                // and it is what the user is looking at.
                let monitor = window
                    .current_monitor()
                    .ok()
                    .flatten()
                    .or_else(|| window.primary_monitor().ok().flatten());

                match monitor {
                    Some(monitor) => {
                        // work_area() is physical pixels; everything above is
                        // logical. Dividing here rather than converting the
                        // result keeps one unit in the clamp.
                        let scale = monitor.scale_factor().max(0.1);
                        let area = monitor.work_area();
                        let work = window_size::WorkArea {
                            x: f64::from(area.position.x) / scale,
                            y: f64::from(area.position.y) / scale,
                            width: f64::from(area.size.width) / scale,
                            height: f64::from(area.size.height) / scale,
                        };
                        // `set_size` sets the *content* size and
                        // `set_position` sets the *frame's* top-left, so a
                        // clamp that only knows the content puts the frame
                        // past the work area by whatever the frame adds. On
                        // the clean VM that was 16 px of width and 39 px of
                        // height, and the bottom edge sat 15 px inside the
                        // taskbar on every screen
                        // (docs/verification/first-run-2026-09-06.md, New
                        // defect 1). Measured from this window rather than
                        // assumed: the frame differs by DPI and by theme, and
                        // a number hardcoded from one VM would be wrong
                        // everywhere else.
                        let decoration = match (window.outer_size(), window.inner_size()) {
                            (Ok(outer), Ok(inner)) => {
                                let dec = (
                                    f64::from(outer.width.saturating_sub(inner.width)) / scale,
                                    f64::from(outer.height.saturating_sub(inner.height)) / scale,
                                );
                                if dec == (0.0, 0.0) {
                                    // Not an error - an undecorated window is
                                    // a real thing - but on a decorated one it
                                    // means the frame was not up yet, and this
                                    // is the defect above coming back quietly.
                                    eprintln!(
                                        "note: window frame measured as 0x0; clamping as if undecorated"
                                    );
                                }
                                dec
                            }
                            _ => {
                                // Said out loud rather than silently: the
                                // clamp still runs and still fits the content,
                                // it just cannot account for the frame.
                                eprintln!(
                                    "warning: could not measure the window frame; clamping the content size only"
                                );
                                (0.0, 0.0)
                            }
                        };

                        let placed = window_size::clamp_to_work_area(
                            work, REQUESTED, MIN, MARGIN, decoration,
                        );
                        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
                            width: placed.width,
                            height: placed.height,
                        }));
                        let _ =
                            window.set_position(tauri::Position::Logical(tauri::LogicalPosition {
                                x: placed.x,
                                y: placed.y,
                            }));
                    }
                    None => {
                        // No monitor to ask - a headless or virtual display,
                        // or a runtime that will not say. Ask for the default
                        // and let the platform place it, which is exactly the
                        // behaviour before the clamp existed. Said out loud
                        // rather than silently: a size chosen without knowing
                        // the screen is the defect above, and this is the one
                        // case where there is nothing to know it from.
                        eprintln!(
                            "warning: no monitor reported; opening at {}x{} unclamped",
                            REQUESTED.0, REQUESTED.1
                        );
                        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
                            width: REQUESTED.0,
                            height: REQUESTED.1,
                        }));
                    }
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running DR Companion")
        .run(|app, event| {
            // The viewer is a separate window with a socket to a bridge that
            // dies with this process. Left alone it outlives the app that made
            // it, connected to nothing, and Task Manager is the only way to be
            // rid of it. Killed by the handle we hold, never by image name -
            // several sessions run on this machine.
            if matches!(event, tauri::RunEvent::Exit) {
                use tauri::Manager;
                viewer::close_viewer(&app.state::<viewer::ViewerProcess>());
            }
        });
}
