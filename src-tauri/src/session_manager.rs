use crate::history_store;
use crate::models::{
    AiContextEvent, HistoryEntry, HistoryQueryRequest, PtyCwdChangedEvent, PtyLifecycleEvent,
    PtyOutputEvent, PtySessionInfo, PtySpawnRequest, RuntimeMetricsSnapshot, TerminalProfile,
};
use crate::osc7::Osc7Parser;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tracing::{debug, instrument, warn};

const PTY_OUTPUT_EVENT: &str = "pty-output";
const PTY_LIFECYCLE_EVENT: &str = "pty-lifecycle";
const PTY_CWD_CHANGED_EVENT: &str = "pty-cwd-changed";
const AI_CONTEXT_EVENT: &str = "ai-context";
const MAX_HISTORY: usize = 3000;
const MAX_CHUNK: usize = 2048;
const MAX_PENDING_CHUNKS: usize = 64;
const STATUS_RUNNING: &str = "running";
const STATUS_STOPPED: &str = "stopped";
const STATUS_CLOSED: &str = "closed";
const STATUS_ERROR: &str = "error";

struct SessionHandle {
    id: String,
    shell: String,
    /// Live CWD. Seeded from the spawn profile and updated by the reader thread as
    /// OSC 7 sequences flow in. Shared `Arc<Mutex>` so `info()` snapshots always
    /// reflect the latest known directory without a second emit round-trip.
    cwd: Arc<Mutex<Option<String>>>,
    status: Arc<Mutex<String>>,
    /// Wrapped in `Option` so `close_session_handle` can `take()` and drop the PTY master before
    /// joining the reader thread — required on Windows ConPTY where `read()` may not return EOF
    /// until the master handle is torn down (see `pty_reader_thread_finishes_after_child_kill`).
    master: Arc<Mutex<Option<Box<dyn MasterPty + Send>>>>,
    writer: Arc<Mutex<Option<Box<dyn Write + Send>>>>,
    child: Arc<Mutex<Box<dyn portable_pty::Child + Send>>>,
    command_buffer: Arc<Mutex<String>>,
    reader_thread: Option<JoinHandle<()>>,
}

impl SessionHandle {
    fn info(&self) -> Result<PtySessionInfo, String> {
        let status = self
            .status
            .lock()
            .map_err(|error| format!("failed to lock session status: {error}"))?
            .clone();
        let cwd = self
            .cwd
            .lock()
            .map_err(|error| format!("failed to lock session cwd: {error}"))?
            .clone();
        Ok(PtySessionInfo {
            id: self.id.clone(),
            shell: self.shell.clone(),
            cwd,
            status,
        })
    }
}

pub struct SessionManager {
    sessions: Arc<Mutex<HashMap<String, SessionHandle>>>,
    history: Arc<Mutex<VecDeque<HistoryEntry>>>,
    history_hydrated: Arc<Mutex<bool>>,
    /// One-shot user-facing message when history file was corrupted and reset (cleared via `take_history_recovery_notice`).
    history_recovery_notice: Arc<Mutex<Option<String>>>,
    counters: Arc<RuntimeCounters>,
    sequence: AtomicU64,
}

impl Default for SessionManager {
    fn default() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            history: Arc::new(Mutex::new(VecDeque::new())),
            history_hydrated: Arc::new(Mutex::new(false)),
            history_recovery_notice: Arc::new(Mutex::new(None)),
            counters: Arc::new(RuntimeCounters::default()),
            sequence: AtomicU64::new(0),
        }
    }
}

#[derive(Default)]
struct RuntimeCounters {
    output_chunks_emitted: AtomicU64,
    output_chunks_dropped: AtomicU64,
    output_bytes_emitted: AtomicU64,
    emit_failures: AtomicU64,
    sequence_anomalies: AtomicU64,
    write_failures: AtomicU64,
    resize_failures: AtomicU64,
    close_failures: AtomicU64,
}

impl SessionManager {
    #[instrument(skip(self, app, request, default_profile))]
    pub fn spawn_session(
        &self,
        app: &AppHandle,
        request: PtySpawnRequest,
        default_profile: TerminalProfile,
    ) -> Result<PtySessionInfo, String> {
        self.ensure_history_hydrated(app)?;
        let profile = request.profile.unwrap_or(default_profile);
        let shell = profile.shell.clone().unwrap_or_else(default_shell);
        let cwd = profile.cwd.clone();
        let cols = request.cols.unwrap_or(120);
        let rows = request.rows.unwrap_or(30);
        let session_id = format!("session-{}", self.sequence.fetch_add(1, Ordering::Relaxed) + 1);

        let pty_system = native_pty_system();
        let pty_pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| format!("failed to open PTY: {error}"))?;

        let mut command_builder = CommandBuilder::new(&shell);
        if let Some(cwd_value) = &cwd {
            command_builder.cwd(PathBuf::from(cwd_value));
        }
        // Keep shell env as close as possible to parent process defaults so PATH/tooling
        // resolution (npm, git, language toolchains) matches normal terminal sessions.
        for (key, value) in std::env::vars() {
            command_builder.env(key, value);
        }
        for (key, value) in profile.env {
            command_builder.env(key, value);
        }
        if profile.minimal_shell_prompt {
            command_builder.env("MACH_TERMINAL_MINIMAL_PROMPT", "1");
        }

        let child = pty_pair
            .slave
            .spawn_command(command_builder)
            .map_err(|error| format!("failed to spawn shell process: {error}"))?;
        drop(pty_pair.slave);

        let writer = pty_pair
            .master
            .take_writer()
            .map_err(|error| format!("failed to get PTY writer: {error}"))?;
        let mut reader = pty_pair
            .master
            .try_clone_reader()
            .map_err(|error| format!("failed to create PTY reader: {error}"))?;

        // Wrap the child handle up-front so the reader thread can `wait()` on EOF
        // and capture the exit code without racing `close_session_handle`.
        let child: Arc<Mutex<Box<dyn portable_pty::Child + Send>>> = Arc::new(Mutex::new(child));
        let child_for_thread = Arc::clone(&child);

        // Seed the live CWD with whatever `cwd` we spawned into so `info()` snapshots
        // and the OSC 7 "same-path dedupe" have a non-`None` baseline.
        let live_cwd: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(cwd.clone()));
        let cwd_for_thread = Arc::clone(&live_cwd);

        let status = Arc::new(Mutex::new(STATUS_RUNNING.to_string()));
        let status_for_thread = Arc::clone(&status);
        let app_for_thread = app.clone();
        let session_id_for_thread = session_id.clone();
        let sequence_for_thread = self.sequence.fetch_add(1, Ordering::Relaxed);
        let sessions_for_thread = Arc::clone(&self.sessions);
        let counters_for_thread = Arc::clone(&self.counters);

        let reader_thread = std::thread::spawn(move || {
            let mut chunk_sequence = sequence_for_thread;
            let mut last_emitted_sequence = chunk_sequence;
            let mut buffer = [0_u8; 8192];
            let mut osc7_parser = Osc7Parser::new();
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => {
                        // Shell exited: wait on the already-dead child to grab its exit code
                        // before the SessionHandle is dropped by the `sessions.remove` below.
                        let exit_code = derive_exit_code(&child_for_thread);
                        let _ = update_status_and_emit(
                            &app_for_thread,
                            &status_for_thread,
                            &session_id_for_thread,
                            STATUS_STOPPED,
                            Some("shell exited".to_string()),
                            exit_code,
                        );
                        if let Ok(mut sessions) = sessions_for_thread.lock() {
                            sessions.remove(&session_id_for_thread);
                        }
                        break;
                    }
                    Ok(bytes_read) => {
                        // Tap the raw bytes for OSC 7 before the UTF-8 lossy copy: the
                        // parser needs the original byte stream (percent-decoding turns
                        // UTF-8 path bytes back into codepoints, and lossy decoding
                        // would mangle any non-UTF-8 byte that happens to land mid-
                        // percent-escape). Emit only on actual change.
                        if let Some(new_cwd) = osc7_parser.feed(&buffer[..bytes_read]) {
                            let should_emit = match cwd_for_thread.lock() {
                                Ok(mut slot) => {
                                    if slot.as_deref() == Some(new_cwd.as_str()) {
                                        false
                                    } else {
                                        *slot = Some(new_cwd.clone());
                                        true
                                    }
                                }
                                Err(_) => false,
                            };
                            if should_emit {
                                let emit_result = app_for_thread.emit(
                                    PTY_CWD_CHANGED_EVENT,
                                    PtyCwdChangedEvent {
                                        session_id: session_id_for_thread.clone(),
                                        cwd: new_cwd,
                                        timestamp_ms: unix_timestamp_ms(),
                                    },
                                );
                                if emit_result.is_err() {
                                    counters_for_thread
                                        .emit_failures
                                        .fetch_add(1, Ordering::Relaxed);
                                    warn!(
                                        session_id = %session_id_for_thread,
                                        "failed to emit pty-cwd-changed event"
                                    );
                                }
                            }
                        }
                        let output = String::from_utf8_lossy(&buffer[..bytes_read]).to_string();
                        let mut pending = VecDeque::new();
                        for chunk in split_chunk(&output, MAX_CHUNK) {
                            pending.push_back(chunk);
                            if pending.len() > MAX_PENDING_CHUNKS {
                                pending.pop_front();
                                counters_for_thread
                                    .output_chunks_dropped
                                    .fetch_add(1, Ordering::Relaxed);
                                debug!(
                                    session_id = %session_id_for_thread,
                                    max_pending = MAX_PENDING_CHUNKS,
                                    "dropped oldest pty output chunk due to backpressure"
                                );
                            }
                        }

                        while let Some(chunk) = pending.pop_front() {
                            chunk_sequence += 1;
                            if chunk_sequence != last_emitted_sequence + 1 {
                                counters_for_thread
                                    .sequence_anomalies
                                    .fetch_add(1, Ordering::Relaxed);
                                debug!(
                                    session_id = %session_id_for_thread,
                                    chunk_sequence,
                                    last_emitted_sequence,
                                    "pty output sequence gap"
                                );
                            }
                            last_emitted_sequence = chunk_sequence;

                            let chunk_bytes = chunk.len() as u64;
                            let emit_result = app_for_thread.emit(
                                PTY_OUTPUT_EVENT,
                                PtyOutputEvent {
                                    session_id: session_id_for_thread.clone(),
                                    data: chunk,
                                    sequence: chunk_sequence,
                                },
                            );
                            if emit_result.is_ok() {
                                counters_for_thread
                                    .output_chunks_emitted
                                    .fetch_add(1, Ordering::Relaxed);
                                counters_for_thread
                                    .output_bytes_emitted
                                    .fetch_add(chunk_bytes, Ordering::Relaxed);
                            } else {
                                counters_for_thread.emit_failures.fetch_add(1, Ordering::Relaxed);
                                warn!(
                                    session_id = %session_id_for_thread,
                                    error = ?emit_result.err(),
                                    "failed to emit pty-output event"
                                );
                            }
                        }
                        if app_for_thread
                            .emit(
                            AI_CONTEXT_EVENT,
                            AiContextEvent {
                                session_id: session_id_for_thread.clone(),
                                event_type: "output_chunk".to_string(),
                                payload: bytes_read.to_string(),
                                sequence: chunk_sequence,
                                timestamp_ms: unix_timestamp_ms(),
                                source: "pty".to_string(),
                            },
                        )
                        .is_err()
                        {
                            counters_for_thread.emit_failures.fetch_add(1, Ordering::Relaxed);
                            warn!(
                                session_id = %session_id_for_thread,
                                "failed to emit ai-context output chunk"
                            );
                        }
                    }
                    Err(error) => {
                        let _ = update_status_and_emit(
                            &app_for_thread,
                            &status_for_thread,
                            &session_id_for_thread,
                            STATUS_ERROR,
                            Some(format!("reader failure: {error}")),
                            None,
                        );
                        if let Ok(mut sessions) = sessions_for_thread.lock() {
                            sessions.remove(&session_id_for_thread);
                        }
                        break;
                    }
                }
            }
        });

        let handle = SessionHandle {
            id: session_id.clone(),
            shell: shell.clone(),
            cwd: live_cwd,
            status,
            master: Arc::new(Mutex::new(Some(pty_pair.master))),
            writer: Arc::new(Mutex::new(Some(writer))),
            child,
            command_buffer: Arc::new(Mutex::new(String::new())),
            reader_thread: Some(reader_thread),
        };

        let mut sessions = self
            .sessions
            .lock()
            .map_err(|error| format!("failed to lock session manager: {error}"))?;
        sessions.insert(session_id.clone(), handle);
        drop(sessions);

        app.emit(
            PTY_LIFECYCLE_EVENT,
            PtyLifecycleEvent {
                session_id: session_id.clone(),
                status: STATUS_RUNNING.to_string(),
                message: Some(format!("spawned {shell}")),
                timestamp_ms: unix_timestamp_ms(),
                exit_code: None,
            },
        )
        .map_err(|error| format!("failed to emit lifecycle event: {error}"))?;

        Ok(PtySessionInfo {
            id: session_id,
            shell,
            cwd,
            status: STATUS_RUNNING.to_string(),
        })
    }

    #[instrument(skip(self, app, data))]
    pub fn write_input(&self, app: &AppHandle, session_id: &str, data: &str) -> Result<(), String> {
        let (writer, command_buffer) = {
            let sessions = self
                .sessions
                .lock()
                .map_err(|error| format!("failed to lock session manager: {error}"))?;
            let session = sessions
                .get(session_id)
                .ok_or_else(|| format!("session `{session_id}` does not exist"))?;
            (Arc::clone(&session.writer), Arc::clone(&session.command_buffer))
        };

        let mut writer = writer
            .lock()
            .map_err(|error| format!("failed to lock session writer: {error}"))?;
        let writer = writer
            .as_mut()
            .ok_or_else(|| format!("session `{session_id}` writer is torn down"))?;
        writer
            .write_all(data.as_bytes())
            .map_err(|error| {
                self.counters.write_failures.fetch_add(1, Ordering::Relaxed);
                warn!(session_id = %session_id, %error, "failed to write to PTY");
                format!("failed to write to PTY: {error}")
            })?;
        writer
            .flush()
            .map_err(|error| {
                self.counters.write_failures.fetch_add(1, Ordering::Relaxed);
                warn!(session_id = %session_id, %error, "failed to flush PTY input");
                format!("failed to flush PTY input: {error}")
            })?;

        let mut command_buffer = command_buffer
            .lock()
            .map_err(|error| format!("failed to lock command buffer: {error}"))?;
        command_buffer.push_str(data);

        if data.contains('\r') || data.contains('\n') {
            let command = crate::input_sanitize::sanitize_command_line_for_history(&command_buffer);
            if !command.is_empty() {
                self.record_history(app, session_id, &command)?;
                app.emit(
                    AI_CONTEXT_EVENT,
                    AiContextEvent {
                        session_id: session_id.to_string(),
                        event_type: "command_submitted".to_string(),
                        payload: command,
                        sequence: self.sequence.fetch_add(1, Ordering::Relaxed),
                        timestamp_ms: unix_timestamp_ms(),
                        source: "input".to_string(),
                    },
                )
                .map_err(|error| format!("failed to emit ai context event: {error}"))?;
            }
            command_buffer.clear();
        }
        Ok(())
    }

    #[instrument(skip(self))]
    pub fn resize_session(&self, session_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let master = {
            let sessions = self
                .sessions
                .lock()
                .map_err(|error| format!("failed to lock session manager: {error}"))?;
            let session = sessions
                .get(session_id)
                .ok_or_else(|| format!("session `{session_id}` does not exist"))?;
            Arc::clone(&session.master)
        };
        let mut master = master
            .lock()
            .map_err(|error| format!("failed to lock PTY master: {error}"))?;
        let master = master
            .as_mut()
            .ok_or_else(|| format!("session `{session_id}` PTY is torn down"))?;
        master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| {
                self.counters.resize_failures.fetch_add(1, Ordering::Relaxed);
                warn!(session_id = %session_id, %error, "failed to resize PTY");
                format!("failed to resize PTY: {error}")
            })
    }

    #[instrument(skip(self, app))]
    pub fn close_session(&self, app: &AppHandle, session_id: &str) -> Result<(), String> {
        let session = {
            let mut sessions = self
                .sessions
                .lock()
                .map_err(|error| format!("failed to lock session manager: {error}"))?;
            sessions.remove(session_id)
        };
        let Some(session) = session else {
            // Idempotent close contract: exiting shells can self-remove from the map
            // before the UI sends `pty_close` from overlay/tab flows.
            debug!(session_id, "close_session ignored for missing session");
            return Ok(());
        };
        update_status_and_emit(
            app,
            &session.status,
            session_id,
            STATUS_CLOSED,
            Some("session closed by user".to_string()),
            None,
        )?;
        close_session_handle(session).map_err(|error| {
            self.counters.close_failures.fetch_add(1, Ordering::Relaxed);
            warn!(session_id = %session_id, %error, "failed to close PTY session handle");
            error
        })
    }

    #[instrument(skip(self))]
    pub fn close_all(&self) -> Result<(), String> {
        let handles = {
            let mut sessions = self
                .sessions
                .lock()
                .map_err(|error| format!("failed to lock session manager: {error}"))?;
            sessions.drain().map(|(_, handle)| handle).collect::<Vec<_>>()
        };
        for handle in handles {
            if let Err(error) = close_session_handle(handle) {
                self.counters.close_failures.fetch_add(1, Ordering::Relaxed);
                warn!(%error, "failed to close session during shutdown");
            }
        }
        Ok(())
    }

    #[instrument(skip(self))]
    pub fn list_sessions(&self) -> Result<Vec<PtySessionInfo>, String> {
        let sessions = self
            .sessions
            .lock()
            .map_err(|error| format!("failed to lock session manager: {error}"))?;
        sessions.values().map(|session| session.info()).collect()
    }

    /// Latest cwd snapshot for a session (OSC7-updated mutex when hooked, else spawn seed).
    pub fn session_cwd_snapshot(&self, session_id: &str) -> Result<Option<String>, String> {
        let sessions = self
            .sessions
            .lock()
            .map_err(|error| format!("failed to lock session manager: {error}"))?;
        let Some(handle) = sessions.get(session_id) else {
            return Ok(None);
        };
        Ok(handle.info().ok().and_then(|info| info.cwd))
    }

    #[instrument(skip(self, app, request))]
    pub fn history_query(&self, app: &AppHandle, request: HistoryQueryRequest) -> Result<Vec<HistoryEntry>, String> {
        self.ensure_history_hydrated(app)?;
        let history = self
            .history
            .lock()
            .map_err(|error| format!("failed to lock history: {error}"))?;
        Ok(query_history_entries(&history, &request))
    }

    #[instrument(skip(self, app, command))]
    pub fn history_replay(&self, app: &AppHandle, session_id: &str, command: &str) -> Result<(), String> {
        let normalized = normalize_history_replay_command(command);
        self.write_input(app, session_id, &normalized)
    }

    fn ensure_history_hydrated(&self, app: &AppHandle) -> Result<(), String> {
        let mut hydrated = self
            .history_hydrated
            .lock()
            .map_err(|error| format!("failed to lock history hydration flag: {error}"))?;
        if *hydrated {
            return Ok(());
        }

        // Disk IO and JSON decoding can be slow; do it without holding the history mutex.
        // We still hold the hydration flag mutex so callers do not observe a partially-hydrated state.
        let mut loaded = VecDeque::new();
        let outcome = history_store::load_history(app, &mut loaded, MAX_HISTORY, &self.sequence)?;
        {
            let mut history = self
                .history
                .lock()
                .map_err(|error| format!("failed to lock history: {error}"))?;
            *history = loaded;
        }
        self.apply_history_load_outcome(outcome)?;
        *hydrated = true;
        Ok(())
    }

    fn apply_history_load_outcome(&self, outcome: history_store::HistoryLoadOutcome) -> Result<(), String> {
        if !outcome.recovered_from_corruption {
            return Ok(());
        }
        let mut notice = self
            .history_recovery_notice
            .lock()
            .map_err(|error| format!("failed to lock history recovery notice: {error}"))?;
        *notice = Some(
            "Command history file was unreadable; it was backed up next to your config and history starts fresh."
                .to_string(),
        );
        Ok(())
    }

    fn record_history(&self, app: &AppHandle, session_id: &str, command: &str) -> Result<(), String> {
        self.ensure_history_hydrated(app)?;
        let snapshot = {
            let mut history = self
                .history
                .lock()
                .map_err(|error| format!("failed to lock history: {error}"))?;
            history.push_back(HistoryEntry {
                id: self.sequence.fetch_add(1, Ordering::Relaxed),
                session_id: session_id.to_string(),
                command: command.to_string(),
                timestamp_ms: unix_timestamp_ms(),
            });
            while history.len() > MAX_HISTORY {
                history.pop_front();
            }
            history.clone()
        };

        // Persist without holding the history mutex.
        history_store::save_history(app, &snapshot)
    }

    pub fn take_history_recovery_notice(&self) -> Option<String> {
        self.history_recovery_notice.lock().ok().and_then(|mut guard| guard.take())
    }

    /// True when a recovery toast message is queued but not yet consumed by `take_history_recovery_notice`.
    pub fn history_recovery_pending(&self) -> bool {
        self.history_recovery_notice
            .lock()
            .ok()
            .map(|guard| guard.is_some())
            .unwrap_or(false)
    }

    pub fn metrics_snapshot(&self) -> Result<RuntimeMetricsSnapshot, String> {
        let active_sessions = self
            .sessions
            .lock()
            .map_err(|error| format!("failed to lock session manager: {error}"))?
            .len() as u64;

        Ok(RuntimeMetricsSnapshot {
            output_chunks_emitted: self.counters.output_chunks_emitted.load(Ordering::Relaxed),
            output_chunks_dropped: self.counters.output_chunks_dropped.load(Ordering::Relaxed),
            output_bytes_emitted: self.counters.output_bytes_emitted.load(Ordering::Relaxed),
            emit_failures: self.counters.emit_failures.load(Ordering::Relaxed),
            sequence_anomalies: self.counters.sequence_anomalies.load(Ordering::Relaxed),
            write_failures: self.counters.write_failures.load(Ordering::Relaxed),
            resize_failures: self.counters.resize_failures.load(Ordering::Relaxed),
            close_failures: self.counters.close_failures.load(Ordering::Relaxed),
            active_sessions,
            max_chunk_size: MAX_CHUNK,
        })
    }
}

fn query_history_entries(history: &VecDeque<HistoryEntry>, request: &HistoryQueryRequest) -> Vec<HistoryEntry> {
    let query = request.query.as_deref().unwrap_or_default().to_lowercase();
    let mut output = Vec::new();
    for entry in history.iter().rev() {
        if let Some(session_id) = &request.session_id {
            if &entry.session_id != session_id {
                continue;
            }
        }
        if !query.is_empty() && !entry.command.to_lowercase().contains(&query) {
            continue;
        }
        output.push(entry.clone());
        if output.len() >= request.limit.unwrap_or(100) {
            break;
        }
    }
    output
}

fn normalize_history_replay_command(command: &str) -> String {
    if command.ends_with('\n') {
        command.to_string()
    } else {
        format!("{command}\n")
    }
}

fn close_session_handle(mut session: SessionHandle) -> Result<(), String> {
    {
        let mut child = session
            .child
            .lock()
            .map_err(|error| format!("failed to lock session process: {error}"))?;
        let _ = child.kill();
        let _ = child.wait();
    }

    // Tear down IO handles before joining the reader so `read()` cannot block forever (Windows ConPTY).
    if let Ok(mut slot) = session.writer.lock() {
        slot.take();
    }
    if let Ok(mut slot) = session.master.lock() {
        slot.take();
    }

    if let Some(reader_thread) = session.reader_thread.take() {
        reader_thread
            .join()
            .map_err(|_| "failed to join PTY reader thread".to_string())?;
    }
    Ok(())
}

fn update_status_and_emit(
    app: &AppHandle,
    status: &Arc<Mutex<String>>,
    session_id: &str,
    next_status: &str,
    message: Option<String>,
    exit_code: Option<i32>,
) -> Result<(), String> {
    if let Ok(mut current) = status.lock() {
        let current_status = current.clone();
        if !can_transition_status(&current_status, next_status) {
            debug!(session_id, current = %current_status, next = next_status, "ignored lifecycle transition");
            return Ok(());
        }
        *current = next_status.to_string();
    }
    let emit_result = app.emit(
        PTY_LIFECYCLE_EVENT,
        PtyLifecycleEvent {
            session_id: session_id.to_string(),
            status: next_status.to_string(),
            message,
            timestamp_ms: unix_timestamp_ms(),
            exit_code,
        },
    );
    if emit_result.is_err() {
        warn!(session_id, next_status, "failed to emit lifecycle event");
    } else {
        debug!(session_id, next_status, "emitted lifecycle event");
    }
    emit_result.map_err(|error| format!("failed to emit lifecycle event: {error}"))
}

/// Lock the shared child handle and wait for it, returning the exit code as an `i32`.
///
/// Called from the reader thread after an EOF (`Ok(0)`) signals the shell exited, so
/// `wait()` should be an effectively non-blocking reap. `portable_pty::ExitStatus::exit_code()`
/// returns `u32`; we downcast to `i32` so the JSON payload keeps conventional signedness
/// (POSIX shells conventionally expose `128 + signal_number` for signal deaths, and those
/// fit comfortably in `i32`). We do not plumb a separate `signal` field in this tranche.
fn derive_exit_code(child: &Arc<Mutex<Box<dyn portable_pty::Child + Send>>>) -> Option<i32> {
    child
        .lock()
        .ok()
        .and_then(|mut c| c.wait().ok())
        .map(|status| status.exit_code() as i32)
}

pub fn can_transition_status(current: &str, next: &str) -> bool {
    if current == next {
        return false;
    }
    if is_terminal_status(current) {
        return false;
    }
    if current == STATUS_RUNNING {
        return matches!(next, STATUS_STOPPED | STATUS_CLOSED | STATUS_ERROR);
    }
    true
}

fn is_terminal_status(status: &str) -> bool {
    matches!(status, STATUS_STOPPED | STATUS_CLOSED | STATUS_ERROR)
}

fn split_chunk(data: &str, max_bytes: usize) -> Vec<String> {
    if data.len() <= max_bytes {
        return vec![data.to_string()];
    }
    let mut output = Vec::new();
    let mut current = String::new();
    for ch in data.chars() {
        if current.len() + ch.len_utf8() > max_bytes {
            output.push(current);
            current = String::new();
        }
        current.push(ch);
    }
    if !current.is_empty() {
        output.push(current);
    }
    output
}

fn unix_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

pub fn default_shell() -> String {
    #[cfg(target_os = "windows")]
    {
        return "pwsh.exe".to_string();
    }
    #[cfg(target_os = "macos")]
    {
        return std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        return std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
    }
    #[allow(unreachable_code)]
    "sh".to_string()
}

#[cfg(test)]
mod tests {
    use super::{
        history_store, normalize_history_replay_command, query_history_entries, split_chunk, SessionManager,
    };
    use crate::models::{HistoryEntry, HistoryQueryRequest};
    use portable_pty::{native_pty_system, CommandBuilder, PtySize};
    use std::collections::VecDeque;
    use std::io::Read;
    use std::sync::atomic::AtomicU64;
    use std::time::{Duration, Instant};
    use tempfile::tempdir;

    #[test]
    fn split_chunk_preserves_content() {
        let data = "abcdefghij";
        let joined = split_chunk(data, 3).join("");
        assert_eq!(joined, data);
    }

    #[test]
    fn recovery_notice_is_one_shot_when_history_recovers() {
        let temp = tempdir().expect("tempdir");
        let history_path = temp.path().join("command_history.json");
        std::fs::write(&history_path, "{broken-json").expect("write corrupt history");

        let mut deque = VecDeque::new();
        let seq = AtomicU64::new(0);
        let outcome =
            history_store::load_history_from_path(&history_path, &mut deque, 3000, &seq).expect("load corrupt history");

        let manager = SessionManager::default();
        manager.apply_history_load_outcome(outcome).expect("apply outcome");
        assert!(manager.take_history_recovery_notice().is_some());
        assert!(manager.take_history_recovery_notice().is_none());
    }

    #[test]
    fn history_recovery_pending_survives_until_take() {
        let manager = SessionManager::default();
        assert!(!manager.history_recovery_pending());
        let outcome = history_store::HistoryLoadOutcome {
            recovered_from_corruption: true,
        };
        manager.apply_history_load_outcome(outcome).expect("apply outcome");
        assert!(manager.history_recovery_pending());
        assert!(manager.history_recovery_pending());
        assert!(manager.take_history_recovery_notice().is_some());
        assert!(!manager.history_recovery_pending());
        assert!(manager.take_history_recovery_notice().is_none());
    }

    #[test]
    fn pty_reader_thread_finishes_after_child_kill() {
        let pty_system = native_pty_system();
        let pty_pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("openpty");

        let command = if cfg!(target_os = "windows") {
            let mut cmd = CommandBuilder::new("cmd.exe");
            cmd.arg("/Q");
            cmd
        } else {
            CommandBuilder::new("/bin/sh")
        };

        let mut child = pty_pair.slave.spawn_command(command).expect("spawn child");
        drop(pty_pair.slave);

        let mut reader = pty_pair.master.try_clone_reader().expect("clone reader");
        let reader_thread = std::thread::spawn(move || {
            let mut buf = [0_u8; 1024];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(_) => continue,
                    Err(_) => break,
                }
            }
        });

        child.kill().expect("kill child");
        let _ = child.wait();
        drop(pty_pair.master);

        let start = Instant::now();
        while start.elapsed() < Duration::from_secs(2) {
            if reader_thread.is_finished() {
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(reader_thread.is_finished(), "expected reader thread to finish after kill");
        reader_thread.join().expect("join reader thread");
    }

    fn history_entry(id: u64, session_id: &str, command: &str, timestamp_ms: u64) -> HistoryEntry {
        HistoryEntry {
            id,
            session_id: session_id.to_string(),
            command: command.to_string(),
            timestamp_ms,
        }
    }

    #[test]
    fn history_query_entries_preserves_newest_first_order_and_limit() {
        let history = VecDeque::from(vec![
            history_entry(1, "session-a", "echo first", 1000),
            history_entry(2, "session-a", "echo second", 2000),
            history_entry(3, "session-a", "echo third", 3000),
        ]);
        let output = query_history_entries(
            &history,
            &HistoryQueryRequest {
                query: None,
                session_id: None,
                limit: Some(2),
            },
        );
        let commands: Vec<&str> = output.iter().map(|entry| entry.command.as_str()).collect();
        assert_eq!(commands, vec!["echo third", "echo second"]);
    }

    #[test]
    fn history_query_entries_filters_case_insensitively_and_by_session() {
        let history = VecDeque::from(vec![
            history_entry(1, "session-a", "npm run test:ux", 1000),
            history_entry(2, "session-b", "git status --short", 2000),
            history_entry(3, "session-a", "NPM run build", 3000),
        ]);
        let output = query_history_entries(
            &history,
            &HistoryQueryRequest {
                query: Some("npm RUN".to_string()),
                session_id: Some("session-a".to_string()),
                limit: None,
            },
        );
        let commands: Vec<&str> = output.iter().map(|entry| entry.command.as_str()).collect();
        assert_eq!(commands, vec!["NPM run build", "npm run test:ux"]);
    }

    #[test]
    fn history_replay_normalization_appends_single_newline_when_missing() {
        assert_eq!(normalize_history_replay_command("echo hello"), "echo hello\n");
        assert_eq!(normalize_history_replay_command("echo hello\n"), "echo hello\n");
    }
}
