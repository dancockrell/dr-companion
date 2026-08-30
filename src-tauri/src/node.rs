//! Running TypeScript tasks, the same way `python.rs` runs Python ones.
//!
//! # Why a near-duplicate of python.rs rather than a shared abstraction
//!
//! The two run different interpreters with different version quirks (Node's
//! `.ts` support is flag-gated below v24, Python's is not) and speak to
//! different runner scripts (`runner.ts` vs `runner.py`). A shared "run an
//! interpreter against a runner script" abstraction would need a parameter
//! for every place the two differ, which is most of the file - the result
//! would be one generic module nobody could read next to two specific ones
//! anybody could. `typescript/dr_companion.ts` mirrors `python/dr_companion.py`
//! for the identical reason, stated in that file's own header.
//!
//! Everything else about the shape - task id validation, one task running at
//! a time, kill+wait for stop, `try_wait` rather than a remembered flag for
//! state - is copied on purpose. A task is a separate process holding a
//! script-API socket regardless of which language wrote it, and the
//! process-lifetime story should not depend on which one a player picked.
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// One line a task printed, on its way to the UI. Same shape as
/// `python::TaskLine`; kept as its own type rather than shared because the
/// event name (`node:line`) is part of what makes it a distinct channel.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeTaskLine {
    pub task: String,
    pub text: String,
    pub error: bool,
}

#[derive(Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NodeTaskState {
    pub running: bool,
    pub task: String,
    pub note: String,
}

#[derive(Default)]
pub struct NodeTasks {
    inner: Mutex<Option<Running>>,
}

struct Running {
    name: String,
    child: Child,
}

/// Same allowlist as `python::valid_task_name`, same reasoning: the id
/// crosses from the webview to a command line, so the character set is what
/// may reach one rather than a list of things to reject.
fn valid_task_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && !name.starts_with('-')
        && !name.contains("..")
        && name.chars().all(|c| {
            c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_' || c == '.'
        })
}

/// A Node that can run `.ts` files, and how to ask it to.
///
/// Below Node 24, running TypeScript directly needs `--experimental-strip-types`
/// (available from 22.6); Node 24 onward strips types unflagged. Getting this
/// wrong doesn't fail loudly - an old Node without the flag rejects the file
/// with a syntax error on the first type annotation it meets, which reads to a
/// player as "the task is broken" rather than "the flag was wrong". So the
/// version is parsed rather than assumed, and the right flag is chosen once
/// here instead of hoping every call site remembers it.
pub struct NodeRuntime {
    pub command: String,
    pub extra_args: Vec<String>,
}

fn parse_node_version(text: &str) -> Option<(u32, u32)> {
    let v = text.trim().strip_prefix('v')?;
    let mut parts = v.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    Some((major, minor))
}

/// The Node to run tasks with, or None when there is no usable one.
///
/// `node` on PATH only - unlike Python's stub-detection dance, Node's own
/// installers (nvm, the official Windows installer, package managers) all
/// put a real, working `node` on PATH by design, so there is no equivalent
/// trap to probe around.
pub fn detect_node() -> Option<NodeRuntime> {
    let mut cmd = Command::new("node");
    cmd.arg("--version");
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let out = cmd.output().ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout).to_string();
    let (major, minor) = parse_node_version(&text)?;

    if major >= 24 {
        Some(NodeRuntime {
            command: "node".into(),
            extra_args: Vec::new(),
        })
    } else if major == 23 || (major == 22 && minor >= 6) {
        Some(NodeRuntime {
            command: "node".into(),
            extra_args: vec!["--experimental-strip-types".into()],
        })
    } else {
        // Present, but too old to run a .ts file at all - distinct from "not
        // found" in node_status below, because "install Node" and "update
        // Node" send a player to different actions.
        None
    }
}

/// Node found, but its version can't run TypeScript directly - kept apart
/// from `detect_node`'s `None` so `node_status` can tell a player which of
/// the two problems they actually have.
fn node_too_old() -> Option<String> {
    let mut cmd = Command::new("node");
    cmd.arg("--version");
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let out = cmd.output().ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let (major, minor) = parse_node_version(&text)?;
    let usable = major >= 24 || major == 23 || (major == 22 && minor >= 6);
    (!usable).then_some(text)
}

/// Where the TypeScript task files live. Resource-resolved for a bundled
/// build, repo layout for `tauri dev` - same pattern as `python::tasks_dir`.
pub(crate) fn tasks_dir(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(p) = app
        .path()
        .resolve("typescript", tauri::path::BaseDirectory::Resource)
    {
        if p.join("tasks").is_dir() {
            return Some(p);
        }
    }
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()?
        .join("typescript");
    dev.join("tasks").is_dir().then_some(dev)
}

/// One runnable task, as `runner.ts` describes it. Same shape as
/// `python::TaskInfo` deliberately - the frontend merges both lists into one.
#[derive(Clone, Serialize, serde::Deserialize)]
pub struct NodeTaskInfo {
    pub id: String,
    pub title: String,
    pub summary: String,
    pub kind: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeStatus {
    /// The Node command to run tasks with, or None when none is usable.
    pub node: Option<String>,
    pub tasks_dir: Option<String>,
    pub tasks: Vec<NodeTaskInfo>,
    /// Plain English for whatever the fields above cannot say alone. Same
    /// four-ish-state reasoning as `python::PythonStatus::note`: "no Node",
    /// "Node too old", "no task folder", "catalog would not run" and "catalog
    /// ran empty" are five different fixes, not one "no tasks".
    pub note: String,
}

#[tauri::command]
pub fn node_status(app: AppHandle) -> NodeStatus {
    let runtime = detect_node();
    let dir = tasks_dir(&app);

    let mut catalog_error = String::new();
    let tasks: Vec<NodeTaskInfo> = match (&runtime, &dir) {
        (Some(rt), Some(d)) => {
            let mut cmd = Command::new(&rt.command);
            cmd.args(&rt.extra_args)
                .arg(d.join("runner.ts"))
                .arg("--list")
                .current_dir(d);
            #[cfg(windows)]
            cmd.creation_flags(CREATE_NO_WINDOW);

            match cmd.output() {
                Ok(out) => match serde_json::from_slice::<Vec<NodeTaskInfo>>(&out.stdout) {
                    Ok(list) => list
                        .into_iter()
                        .filter(|t| valid_task_name(&t.id))
                        .collect(),
                    Err(e) => {
                        let stderr = String::from_utf8_lossy(&out.stderr);
                        catalog_error = format!(
                            "The task catalog could not be read ({e}). Node said:\n{}",
                            stderr.trim()
                        );
                        Vec::new()
                    }
                },
                Err(e) => {
                    catalog_error = format!("Could not run the task catalog: {e}");
                    Vec::new()
                }
            }
        }
        _ => Vec::new(),
    };

    let note = match (&runtime, &dir) {
        (None, _) => match node_too_old() {
            Some(v) => format!(
                "Node {v} is installed, but TypeScript tasks need 22.6 or newer (or 24+). \
                 Update Node to run them."
            ),
            None => "Node.js was not found. TypeScript tasks cannot run without it.".into(),
        },
        (_, None) => "The TypeScript task folder could not be located in this build.".into(),
        _ if !catalog_error.is_empty() => catalog_error,
        _ if tasks.is_empty() => "Node works, but the catalog listed no tasks.".into(),
        _ => String::new(),
    };

    NodeStatus {
        node: runtime.map(|r| r.command),
        tasks_dir: dir.map(|d| d.to_string_lossy().into_owned()),
        tasks,
        note,
    }
}

fn state_of(name: &str, running: bool, note: &str) -> NodeTaskState {
    NodeTaskState {
        running,
        task: name.to_string(),
        note: note.to_string(),
    }
}

/// Start a TypeScript task. Replaces a running one rather than stacking -
/// same rule as `python::run_python_task`, same reason: two tasks driving one
/// character is never what anybody meant.
#[tauri::command]
pub fn run_node_task(
    app: AppHandle,
    tasks: State<'_, NodeTasks>,
    name: String,
) -> Result<NodeTaskState, String> {
    if !valid_task_name(&name) {
        return Err(format!("{name:?} is not a task name."));
    }

    let runtime = detect_node().ok_or_else(|| match node_too_old() {
        Some(v) => {
            format!("Node {v} is installed, but TypeScript tasks need 22.6 or newer (or 24+).")
        }
        None => "Node.js was not found on this machine. Install it, or run the task \
                  yourself with: node typescript/runner.ts run <id>"
            .to_string(),
    })?;
    let dir = tasks_dir(&app).ok_or("Could not find the TypeScript task folder in this build.")?;
    let runner = dir.join("runner.ts");
    if !runner.exists() {
        return Err(format!(
            "The task runner is missing from {}.",
            dir.display()
        ));
    }

    stop_node_task(app.clone(), tasks.clone());

    let mut cmd = Command::new(&runtime.command);
    cmd.args(&runtime.extra_args)
        .arg(&runner)
        .arg("run")
        .arg(&name)
        .current_dir(&dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Could not start {name}: {e}"))?;

    for (stream, is_err) in [
        (
            child
                .stdout
                .take()
                .map(|s| Box::new(s) as Box<dyn std::io::Read + Send>),
            false,
        ),
        (
            child
                .stderr
                .take()
                .map(|s| Box::new(s) as Box<dyn std::io::Read + Send>),
            true,
        ),
    ] {
        let Some(stream) = stream else { continue };
        let app = app.clone();
        let task = name.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stream);
            for line in reader.lines().map_while(Result::ok) {
                let _ = app.emit(
                    "node:line",
                    NodeTaskLine {
                        task: task.clone(),
                        text: line,
                        error: is_err,
                    },
                );
            }
        });
    }

    let st = state_of(&name, true, "");
    *tasks.inner.lock().unwrap() = Some(Running { name, child });
    let _ = app.emit("node:state", st.clone());
    Ok(st)
}

/// Stop the running task, if there is one. Kill + wait, same as
/// `python::stop_python_task` - a task's only route to the game is the
/// script-API socket, which dies with the process.
#[tauri::command]
pub fn stop_node_task(app: AppHandle, tasks: State<'_, NodeTasks>) -> NodeTaskState {
    let mut guard = tasks.inner.lock().unwrap();
    let stopped = if let Some(mut running) = guard.take() {
        let _ = running.child.kill();
        let _ = running.child.wait();
        running.name
    } else {
        String::new()
    };

    let st = state_of("", false, if stopped.is_empty() { "" } else { "Stopped." });
    if !stopped.is_empty() {
        let _ = app.emit("node:state", st.clone());
    }
    st
}

/// Whether a task is still running, checked rather than remembered - same
/// `try_wait` reasoning as `python::python_task_state`.
#[tauri::command]
pub fn node_task_state(app: AppHandle, tasks: State<'_, NodeTasks>) -> NodeTaskState {
    let mut guard = tasks.inner.lock().unwrap();
    let Some(running) = guard.as_mut() else {
        return state_of("", false, "");
    };

    match running.child.try_wait() {
        Ok(Some(status)) => {
            let name = running.name.clone();
            *guard = None;
            let note = if status.success() {
                format!("{name} finished.")
            } else {
                format!("{name} exited with {status}.")
            };
            let st = state_of("", false, &note);
            let _ = app.emit("node:state", st.clone());
            st
        }
        Ok(None) => state_of(&running.name, true, ""),
        Err(_) => state_of(&running.name, true, "Could not check the task process."),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_anything_that_could_become_more_than_an_id() {
        for bad in [
            "",
            "../secrets",
            "a/b",
            "a\\b",
            "task..watch",
            "Task",
            "task name",
            "task;rm",
            "task&whoami",
            "-rf",
            "-c",
            &"a".repeat(65),
        ] {
            assert!(!valid_task_name(bad), "accepted {bad:?}");
        }
    }

    #[test]
    fn accepts_the_ids_the_catalog_actually_publishes() {
        for good in ["task.watch", "user.smoke_test", "user.my_task"] {
            assert!(valid_task_name(good), "refused {good:?}");
        }
    }

    #[test]
    fn parses_node_versions_the_way_the_gate_expects() {
        assert_eq!(parse_node_version("v22.6.0\n"), Some((22, 6)));
        assert_eq!(parse_node_version("v24.0.1"), Some((24, 0)));
        assert_eq!(parse_node_version("v18.19.0"), Some((18, 19)));
        assert_eq!(parse_node_version("not a version"), None);
    }
}
