use mach_terminal_lib::models::{WorkspaceLayout, WorkspacePaneSnapshot, WORKSPACE_LAYOUT_SCHEMA_VERSION};
use mach_terminal_lib::workspace_store::{load_workspace_layout_from_path, save_workspace_layout_to_path};
use std::fs;
use tempfile::tempdir;

fn sample_layout() -> WorkspaceLayout {
    WorkspaceLayout {
        schema_version: WORKSPACE_LAYOUT_SCHEMA_VERSION,
        root_pane_id: "pane-1".to_string(),
        panes: vec![
            WorkspacePaneSnapshot {
                id: "pane-1".to_string(),
                session_id: Some("session-a".to_string()),
            },
            WorkspacePaneSnapshot {
                id: "pane-2".to_string(),
                session_id: None,
            },
        ],
        active_pane_id: "pane-2".to_string(),
        split_direction: "column".to_string(),
    }
}

#[test]
fn workspace_layout_save_and_load_round_trip() {
    let temp = tempdir().expect("tempdir");
    let path = temp.path().join("workspace_layout.json");
    let layout = sample_layout();

    save_workspace_layout_to_path(&path, &layout).expect("save");
    let loaded = load_workspace_layout_from_path(&path).expect("load").expect("some layout");
    assert_eq!(loaded.schema_version, WORKSPACE_LAYOUT_SCHEMA_VERSION);
    assert_eq!(loaded.active_pane_id, "pane-2");
    assert_eq!(loaded.panes.len(), 2);
    assert_eq!(loaded.panes[0].session_id.as_deref(), Some("session-a"));
}

#[test]
fn workspace_layout_missing_file_is_none() {
    let temp = tempdir().expect("tempdir");
    let path = temp.path().join("missing_workspace_layout.json");
    let loaded = load_workspace_layout_from_path(&path).expect("load");
    assert!(loaded.is_none());
}

#[test]
fn workspace_layout_corrupt_json_backs_up_and_returns_none() {
    let temp = tempdir().expect("tempdir");
    let path = temp.path().join("workspace_layout.json");
    fs::write(&path, "{not-json").expect("write corrupt");

    let loaded = load_workspace_layout_from_path(&path).expect("load");
    assert!(loaded.is_none());

    let backup_count = fs::read_dir(temp.path())
        .expect("read dir")
        .filter_map(Result::ok)
        .filter(|entry| entry.file_name().to_string_lossy().contains("corrupt-"))
        .count();
    assert!(backup_count >= 1);
}

#[test]
fn workspace_layout_newer_schema_version_errors() {
    let temp = tempdir().expect("tempdir");
    let path = temp.path().join("workspace_layout.json");
    fs::write(
        &path,
        r#"{"schemaVersion":999,"rootPaneId":"pane-1","panes":[],"activePaneId":"pane-1","splitDirection":"column"}"#,
    )
    .expect("write future version");

    let error = load_workspace_layout_from_path(&path).expect_err("unsupported version");
    assert!(error.contains("newer than supported"));
}
