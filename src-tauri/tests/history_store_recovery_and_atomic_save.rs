use mach_terminal_lib::history_store;
use mach_terminal_lib::models::HistoryEntry;
use std::collections::VecDeque;
use std::fs;
use std::sync::atomic::AtomicU64;
use std::sync::Arc;
use std::thread;
use tempfile::tempdir;

#[test]
fn corrupt_history_is_backed_up_and_recovers_empty() {
    let temp = tempdir().expect("tempdir");
    let history_path = temp.path().join("command_history.json");
    fs::write(&history_path, "{broken-json").expect("write corrupt history");

    let mut deque = VecDeque::new();
    let seq = AtomicU64::new(0);
    let outcome =
        history_store::load_history_from_path(&history_path, &mut deque, 3000, &seq).expect("load history from path");

    assert!(outcome.recovered_from_corruption);
    assert!(deque.is_empty(), "expected empty history after recovery");

    let backup_count = fs::read_dir(temp.path())
        .expect("read temp dir")
        .filter_map(Result::ok)
        .filter(|entry| entry.file_name().to_string_lossy().contains("corrupt-"))
        .count();
    assert!(backup_count >= 1, "expected at least one corrupt backup file");
}

#[test]
fn concurrent_saves_produce_valid_loadable_history() {
    let temp = tempdir().expect("tempdir");
    let history_path = temp.path().join("command_history.json");

    let mut a = VecDeque::new();
    for i in 0..50_u64 {
        a.push_back(HistoryEntry {
            id: i,
            session_id: "session-a".to_string(),
            command: format!("echo a-{i}"),
            timestamp_ms: 1_700_000_000_000 + i,
        });
    }
    let mut b = VecDeque::new();
    for i in 0..50_u64 {
        b.push_back(HistoryEntry {
            id: 1000 + i,
            session_id: "session-b".to_string(),
            command: format!("echo b-{i}"),
            timestamp_ms: 1_700_000_000_000 + 1000 + i,
        });
    }

    let a = Arc::new(a);
    let b = Arc::new(b);

    let t1 = {
        let a = Arc::clone(&a);
        let history_path = history_path.clone();
        thread::spawn(move || history_store::save_history_to_path(&history_path, &a).expect("save a"))
    };
    let t2 = {
        let b = Arc::clone(&b);
        let history_path = history_path.clone();
        thread::spawn(move || history_store::save_history_to_path(&history_path, &b).expect("save b"))
    };

    t1.join().expect("join t1");
    t2.join().expect("join t2");

    let mut loaded = VecDeque::new();
    let seq = AtomicU64::new(0);
    let outcome =
        history_store::load_history_from_path(&history_path, &mut loaded, 3000, &seq).expect("load after saves");

    assert!(
        !outcome.recovered_from_corruption,
        "expected final file to be valid JSON (no recovery), but it was corrupt"
    );
    assert!(!loaded.is_empty(), "expected some history entries after load");
}

