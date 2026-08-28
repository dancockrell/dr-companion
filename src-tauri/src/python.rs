//! Running Python tasks, which is what a flow is now.
//!
//! Flows used to be seven entries in `src/data/taskFlows.ts`, stepped by
//! `flowDriver.ts`, with conditions in a string grammar parsed by
//! `flowConditions.ts`. That was a scripting language hand-rolled in
//! TypeScript inside a project whose scripting language is Python. The flows
//! now live in `python/tasks/`, and this is how the app runs one.
//!
//! # The shape, and why it is a separate process
//!
//! A task is a normal Python program. It connects back to this app over the
//! script API (`script_api.rs`) exactly as one a player wrote by hand would,
//! sends its commands through the same socket, and is subject to the same
//! rate cap. There is no privileged path for a task the app happens to ship.
//!
//! That boundary is the point. A task cannot corrupt the client's state
//! because it has no access to it - it has a socket, and everything it can do
//! goes through the same door a third-party script uses. A task that hangs,
//! loops or crashes takes down a process, and the client notices and says so.
//!
//! # What is validated, and what deliberately is not
//!
//! The task *id* is validated hard: `[a-z0-9._-]+`, no leading hyphen, no
//! `..`. It arrives from the webview and reaches a command line, so the
//! character set is an allowlist. `runner.py` separately refuses an id that
//! names nothing, which is a different question with a different answer.
//!
//! The task's *contents* are not validated at all, and cannot be. A task is a
//! Python program; it can do whatever Python can do. That is the same trust a
//! player extends to any Lich script they install, and pretending otherwise -
//! scanning for dangerous calls, say - would be security theatre that also
//! broke legitimate tasks.

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

/// One line a task printed, on its way to the UI.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskLine {
    pub task: String,
    pub text: String,
    /// True for stderr. A task's own diagnostics are worth showing
    /// differently from what it chose to report.
    pub error: bool,
}

/// Whether a task is running, as a fact rather than an inference from silence.
#[derive(Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TaskState {
    pub running: bool,
    /// Which task, when one is running. Empty otherwise.
    pub task: String,
    /// Set when a task ended on its own. Empty while running.
    pub note: String,
}

#[derive(Default)]
pub struct PythonTasks {
    inner: Mutex<Option<Running>>,
}

struct Running {
    name: String,
    child: Child,
}

/// A task id that cannot become anything but a task id.
///
/// The id crosses from the webview into a command line, so the character set
/// is an allowlist rather than a list of things to reject: lowercase, digits,
/// dot, hyphen, underscore. That forecloses path traversal, argument injection
/// and absolute paths together instead of trying to spot each one.
///
/// A leading hyphen is refused separately, because `-c` passes the character
/// rule and is an option to the interpreter by every other reading. `..`
/// likewise, which the dot allowance would otherwise admit.
///
/// `runner.py` refuses an unknown id on its own account as well. Two checks,
/// because this one is about what may reach a command line and that one is
/// about what exists - different questions with different answers.
fn valid_task_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && !name.starts_with('-')
        && !name.contains("..")
        && name.chars().all(|c| {
            c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_' || c == '.'
        })
}

/// The interpreter to run tasks with.
///
/// `python` first, because a machine that has it on PATH has the one its owner
/// expects. The Windows Store stub at `WindowsApps\python.exe` is a known trap
/// on this machine - it exits without running anything - so a version probe is
/// used rather than mere presence: a stub answers nothing useful.
pub fn detect_python() -> Option<String> {
    for candidate in ["python", "python3", "py"] {
        let mut cmd = Command::new(candidate);
        cmd.arg("--version");
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);
        if let Ok(out) = cmd.output() {
            let text = String::from_utf8_lossy(&out.stdout).to_string()
                + &String::from_utf8_lossy(&out.stderr);
            if text.to_lowercase().contains("python 3") {
                return Some(candidate.to_string());
            }
        }
    }

    // Known install locations, newest first, for the case where Python is
    // present but not on the PATH this process inherited - which is the normal
    // state for anything installed after the app started.
    let local = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Some(l) = local {
        roots.push(l.join("Programs").join("Python"));
    }
    roots.push(PathBuf::from("C:/"));

    for root in roots {
        let Ok(entries) = std::fs::read_dir(&root) else {
            continue;
        };
        let mut found: Vec<PathBuf> = entries
            .flatten()
            .map(|e| e.path())
            .filter(|p| {
                p.file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| n.to_lowercase().starts_with("python3"))
            })
            .collect();
        found.sort();
        found.reverse();
        for dir in found {
            let exe = dir.join("python.exe");
            if exe.exists() {
                return Some(exe.to_string_lossy().into_owned());
            }
        }
    }
    None
}

/// Where the task files live.
///
/// Resource-resolved so a bundled build finds the copy shipped beside it, with
/// the repo layout as the fallback that makes `tauri dev` work.
pub(crate) fn tasks_dir(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(p) = app
        .path()
        .resolve("python", tauri::path::BaseDirectory::Resource)
    {
        if p.join("tasks").is_dir() {
            return Some(p);
        }
    }
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()?
        .join("python");
    dev.join("tasks").is_dir().then_some(dev)
}

/// One runnable task, as `runner.py` describes it.
#[derive(Clone, Serialize, serde::Deserialize)]
pub struct TaskInfo {
    pub id: String,
    pub title: String,
    pub summary: String,
    /// "read-only" or "sends commands". Shown, because a task that watches and
    /// a task that drives a live character deserve visibly different buttons.
    pub kind: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PythonStatus {
    /// The interpreter, or None when none was found.
    pub python: Option<String>,
    /// Where tasks are being read from, when that could be established.
    pub tasks_dir: Option<String>,
    /// Tasks available to run, as `runner.py` lists them.
    pub tasks: Vec<TaskInfo>,
    /// Plain English for whatever the fields above cannot say alone.
    pub note: String,
}

/// What can be run, and whether anything can be run at all.
///
/// The list comes from `runner.py --list` rather than from scanning the folder,
/// so the app and a person at a prompt read the same catalog. Scanning would
/// also be wrong: `tasks/flows.py` is one file holding seven flows, so a
/// per-file listing would show one entry that does nothing and hide six that do.
///
/// Four states rather than two, because they need four different fixes: no
/// interpreter, no task folder, a catalog that would not run, and a catalog
/// that ran and is empty. Collapsing any of those into "no tasks" sends
/// somebody to look in the wrong place.
#[tauri::command]
pub fn python_status(app: AppHandle) -> PythonStatus {
    let python = detect_python();
    let dir = tasks_dir(&app);

    let mut catalog_error = String::new();
    let tasks: Vec<TaskInfo> = match (&python, &dir) {
        (Some(py), Some(d)) => {
            let mut cmd = Command::new(py);
            cmd.arg(d.join("runner.py"))
                .arg("--list")
                .current_dir(d)
                .env("PYTHONPATH", d);
            #[cfg(windows)]
            cmd.creation_flags(CREATE_NO_WINDOW);

            match cmd.output() {
                Ok(out) => match serde_json::from_slice::<Vec<TaskInfo>>(&out.stdout) {
                    Ok(list) => list.into_iter().filter(|t| valid_task_name(&t.id)).collect(),
                    Err(e) => {
                        // The interpreter's own words, not a summary of them.
                        // A catalog that failed to import says exactly which
                        // module broke, and that is the whole of the answer.
                        let stderr = String::from_utf8_lossy(&out.stderr);
                        catalog_error = format!(
                            "The task catalog could not be read ({e}). Python said:\n{}",
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

    let note = match (&python, &dir) {
        (None, _) => "Python 3 was not found. Tasks cannot run without it.".into(),
        (_, None) => "The task folder could not be located in this build.".into(),
        _ if !catalog_error.is_empty() => catalog_error,
        _ if tasks.is_empty() => "Python works, but the catalog listed no tasks.".into(),
        _ => String::new(),
    };

    PythonStatus {
        python,
        tasks_dir: dir.map(|d| d.to_string_lossy().into_owned()),
        tasks,
        note,
    }
}

fn state_of(name: &str, running: bool, note: &str) -> TaskState {
    TaskState {
        running,
        task: name.to_string(),
        note: note.to_string(),
    }
}

/// Start a task. Replaces a running one rather than stacking.
///
/// Two tasks driving one character is never what anybody meant, and the second
/// press is a correction rather than a request for both - the same call
/// `FlowDriver.start` made, kept because it was right.
#[tauri::command]
pub fn run_python_task(
    app: AppHandle,
    tasks: State<'_, PythonTasks>,
    name: String,
) -> Result<TaskState, String> {
    if !valid_task_name(&name) {
        return Err(format!("{name:?} is not a task name."));
    }

    let python = detect_python().ok_or(
        "Python 3 was not found on this machine. Install it, or run the task \
         yourself with: python python/runner.py run <id>",
    )?;
    let dir = tasks_dir(&app).ok_or("Could not find the task folder in this build.")?;
    let runner = dir.join("runner.py");
    if !runner.exists() {
        return Err(format!("The task runner is missing from {}.", dir.display()));
    }

    stop_python_task(app.clone(), tasks.clone());

    let mut cmd = Command::new(&python);
    cmd.arg("-u") // unbuffered, or output arrives in blocks long after the fact
        .arg(&runner)
        .arg("run")
        .arg(&name)
        .current_dir(&dir)
        // So `from flow import ...` resolves to the shipped copy rather than
        // whatever happens to be on the interpreter's path.
        .env("PYTHONPATH", &dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Could not start {name}: {e}"))?;

    for (stream, is_err) in [
        (child.stdout.take().map(|s| Box::new(s) as Box<dyn std::io::Read + Send>), false),
        (child.stderr.take().map(|s| Box::new(s) as Box<dyn std::io::Read + Send>), true),
    ] {
        let Some(stream) = stream else { continue };
        let app = app.clone();
        let task = name.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stream);
            for line in reader.lines().map_while(Result::ok) {
                let _ = app.emit(
                    "python:line",
                    TaskLine {
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
    let _ = app.emit("python:state", st.clone());
    Ok(st)
}

/// Stop the running task, if there is one.
///
/// Killing the process is the whole mechanism, and it is enough: a task's only
/// route to the game is the script API socket, which dies with it. There is no
/// half-stopped state where commands keep going.
#[tauri::command]
pub fn stop_python_task(app: AppHandle, tasks: State<'_, PythonTasks>) -> TaskState {
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
        let _ = app.emit("python:state", st.clone());
    }
    st
}

/// Whether a task is still running, checked rather than remembered.
///
/// `try_wait` is the point: a task that exited on its own leaves this struct
/// holding a dead child, and reporting that as "running" is the same defect
/// this project keeps finding - a stale flag that looks exactly like a live
/// one. Asking the OS costs nothing and cannot go stale.
#[tauri::command]
pub fn python_task_state(app: AppHandle, tasks: State<'_, PythonTasks>) -> TaskState {
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
            let _ = app.emit("python:state", st.clone());
            st
        }
        Ok(None) => state_of(&running.name, true, ""),
        // Cannot tell. Reported as still running rather than guessing it
        // stopped, because a Stop button that has gone grey on a task which is
        // in fact still sending commands is the worse of the two errors.
        Err(_) => state_of(&running.name, true, "Could not check the task process."),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every one of these is a thing that must never reach a command line.
    ///
    /// `task.py` used to be on this list and is not any more: dots became legal
    /// when ids became `flow.hunt`, and an id is no longer a filename - it is a
    /// key `runner.py` looks up in a dict, so a dotted id that matches nothing
    /// is refused there by name. The list is about command-line safety, which
    /// is why traversal, separators, spaces, shell metacharacters and a leading
    /// hyphen all stay.
    #[test]
    fn refuses_anything_that_could_become_more_than_an_id() {
        for bad in [
            "",
            "../secrets",
            "a/b",
            "a\\b",
            "flow..hunt",
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
        for good in [
            "flow.hunt",
            "flow.to_healer",
            "task.watch",
            "example.smart_recover",
            "t2",
        ] {
            assert!(valid_task_name(good), "refused {good:?}");
        }
    }

    /// The rejection list and the catalog have to be checked against each
    /// other, not only each against itself: a validator that refuses every id
    /// the app ships would pass the test above and break every button.
    #[test]
    fn the_shipped_catalog_survives_its_own_validator() {
        let catalog = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("python")
            .join("runner.py");
        let Ok(src) = std::fs::read_to_string(&catalog) else {
            // Said out loud rather than passing quietly. A test that silently
            // skips is indistinguishable from one that ran and found nothing.
            panic!("could not read {} - this test checked nothing", catalog.display());
        };

        let ids: Vec<&str> = src
            .lines()
            .filter_map(|l| l.trim().strip_prefix('"')?.split('"').next())
            .filter(|s| s.contains('.') && !s.contains(' '))
            .collect();

        // The denominator, asserted below the real count so it catches a
        // parser that matched nothing and never needs touching otherwise.
        assert!(ids.len() >= 8, "only parsed {} ids from runner.py", ids.len());
        for id in ids {
            assert!(valid_task_name(id), "the catalog ships {id:?}, which this refuses");
        }
    }
}
