use mach_terminal_lib::osc7::Osc7Parser;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::Read;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[test]
fn pty_spawn_resize_close() {
    let pty_system = native_pty_system();
    let pty_pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .expect("failed to create pty");

    let command = if cfg!(target_os = "windows") {
        let mut cmd = CommandBuilder::new("cmd.exe");
        cmd.arg("/Q");
        cmd
    } else {
        CommandBuilder::new("/bin/sh")
    };

    let mut child = pty_pair
        .slave
        .spawn_command(command)
        .expect("failed to spawn shell");

    pty_pair
        .master
        .resize(PtySize {
            rows: 30,
            cols: 100,
            pixel_width: 0,
            pixel_height: 0,
        })
        .expect("resize should succeed");

    child.kill().expect("kill should succeed");
    let _ = child.wait();
}

#[test]
fn pty_write_and_output_round_trip() {
    let pty_system = native_pty_system();
    let pty_pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .expect("failed to create pty");

    let command = if cfg!(target_os = "windows") {
        let mut cmd = CommandBuilder::new("cmd.exe");
        cmd.arg("/Q");
        cmd
    } else {
        CommandBuilder::new("/bin/sh")
    };

    let mut child = pty_pair
        .slave
        .spawn_command(command)
        .expect("failed to spawn shell");

    let mut writer = pty_pair.master.take_writer().expect("writer");
    let mut reader = pty_pair.master.try_clone_reader().expect("reader");

    let input = if cfg!(target_os = "windows") {
        "echo pty-write-test\r\nexit\r\n"
    } else {
        "echo pty-write-test\nexit\n"
    };

    std::io::Write::write_all(&mut writer, input.as_bytes()).expect("write input");

    let start = Instant::now();
    let mut output = String::new();
    let mut buf = [0_u8; 2048];
    while start.elapsed() < Duration::from_secs(5) {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(bytes_read) => {
                output.push_str(&String::from_utf8_lossy(&buf[..bytes_read]));
                if output.to_lowercase().contains("pty-write-test") {
                    break;
                }
            }
            Err(_) => break,
        }
    }

    assert!(
        output.to_lowercase().contains("pty-write-test"),
        "expected command output in terminal stream, got: {output}"
    );

    let _ = child.kill();
    let _ = child.wait();
}

/// Exercises the exact pattern `session_manager::derive_exit_code` uses: share the
/// child inside an `Arc<Mutex<Box<dyn Child + Send>>>`, `wait()` through the lock,
/// then downcast the `u32` exit code from `portable_pty::ExitStatus::exit_code()`
/// to `i32`. Proves the cross-platform exit-code contract we rely on in the reader
/// thread's EOF path.
#[test]
fn pty_stopped_reports_non_zero_exit_code() {
    let pty_system = native_pty_system();
    let pty_pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .expect("failed to create pty");

    let command = if cfg!(target_os = "windows") {
        let mut cmd = CommandBuilder::new("cmd.exe");
        cmd.arg("/C");
        cmd.arg("exit 7");
        cmd
    } else {
        let mut cmd = CommandBuilder::new("/bin/sh");
        cmd.arg("-c");
        cmd.arg("exit 7");
        cmd
    };

    let child = pty_pair
        .slave
        .spawn_command(command)
        .expect("failed to spawn shell");
    drop(pty_pair.slave);

    let child: Arc<Mutex<Box<dyn portable_pty::Child + Send>>> = Arc::new(Mutex::new(child));

    // Drain the master in a background thread so ConPTY / the kernel does not stall
    // the child on a full output buffer. We don't care about what is read, only that
    // the pipe is not backpressured while the shell exits.
    let mut reader = pty_pair.master.try_clone_reader().expect("reader");
    let drainer = std::thread::spawn(move || {
        let mut buf = [0_u8; 1024];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(_) => continue,
                Err(_) => break,
            }
        }
    });

    // Mirrors `derive_exit_code` in the session_manager: share a lock on the child
    // handle and cast the `u32` status down to a signed `i32` for the wire.
    let start = Instant::now();
    let exit_code = loop {
        if start.elapsed() > Duration::from_secs(15) {
            panic!("timed out waiting for shell to exit");
        }
        let mut locked = child.lock().expect("child mutex should not be poisoned");
        match locked.try_wait() {
            Ok(Some(status)) => break Some(status.exit_code() as i32),
            Ok(None) => {
                drop(locked);
                std::thread::sleep(Duration::from_millis(25));
            }
            Err(_) => break None,
        }
    };

    // Release the master so the drainer thread can observe EOF and return; keeping
    // the test hermetic regardless of ConPTY EOF timing.
    drop(pty_pair.master);
    let _ = drainer.join();

    assert_eq!(exit_code, Some(7), "expected shell to exit with code 7");
}

/// End-to-end sanity check for the OSC 7 plumbing: spawn a shell, have it emit a
/// raw `ESC ] 7 ; file://host/path BEL` sequence, collect the PTY output into
/// `Osc7Parser`, and assert the parser surfaces the decoded path. Mirrors what
/// the real reader thread does in [`session_manager::spawn_session`] without the
/// Tauri event bus in the middle.
#[test]
fn pty_emits_osc7_to_parser() {
    let pty_system = native_pty_system();
    let pty_pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .expect("failed to create pty");

    // Pick a shell invocation that can emit raw ESC/BEL to stdout and exit.
    let (command, expected_cwd) = if cfg!(target_os = "windows") {
        // `powershell.exe` is guaranteed on Windows; `[char]27` / `[char]7` give
        // us raw ESC / BEL, and `-NoProfile` keeps the output free of prompt noise.
        let mut cmd = CommandBuilder::new("powershell.exe");
        cmd.arg("-NoProfile");
        cmd.arg("-NoLogo");
        cmd.arg("-Command");
        cmd.arg("[Console]::Out.Write([char]27 + ']7;file:///C:/Windows/Temp' + [char]7); exit 0");
        (cmd, "C:\\Windows\\Temp".to_string())
    } else {
        let mut cmd = CommandBuilder::new("/bin/sh");
        cmd.arg("-c");
        cmd.arg("printf '\\033]7;file:///tmp\\007'; exit 0");
        (cmd, "/tmp".to_string())
    };

    let child = pty_pair
        .slave
        .spawn_command(command)
        .expect("failed to spawn shell");
    drop(pty_pair.slave);

    let child: Arc<Mutex<Box<dyn portable_pty::Child + Send>>> = Arc::new(Mutex::new(child));

    // Drain the master into an Osc7Parser until the child exits or we hit a timeout.
    // ConPTY may wrap / recolor content but OSC 7 payloads pass through verbatim.
    let mut reader = pty_pair.master.try_clone_reader().expect("reader");
    let child_drain = Arc::clone(&child);
    let drainer = std::thread::spawn(move || -> Option<String> {
        let mut parser = Osc7Parser::new();
        let mut buf = [0_u8; 2048];
        let start = Instant::now();
        let mut found: Option<String> = None;
        loop {
            if start.elapsed() > Duration::from_secs(15) {
                break;
            }
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(bytes_read) => {
                    if let Some(path) = parser.feed(&buf[..bytes_read]) {
                        found = Some(path);
                        // Keep reading until EOF so the child can exit cleanly; we've
                        // already captured what we came for.
                    }
                    // Short-circuit once we've seen the path AND the child has exited.
                    if found.is_some() {
                        if let Ok(mut locked) = child_drain.lock() {
                            if matches!(locked.try_wait(), Ok(Some(_))) {
                                break;
                            }
                        }
                    }
                }
                Err(_) => break,
            }
        }
        found
    });

    // Ensure we don't block the drainer forever if the test misfires: wait with a
    // timeout, then drop the master to force EOF and join the drainer.
    let start = Instant::now();
    loop {
        if start.elapsed() > Duration::from_secs(15) {
            break;
        }
        let mut locked = child.lock().expect("child mutex should not be poisoned");
        match locked.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {
                drop(locked);
                std::thread::sleep(Duration::from_millis(25));
            }
            Err(_) => break,
        }
    }
    drop(pty_pair.master);
    let decoded = drainer.join().expect("drainer thread panicked");

    assert_eq!(
        decoded.as_deref(),
        Some(expected_cwd.as_str()),
        "expected Osc7Parser to surface the shell-emitted cwd",
    );
}
