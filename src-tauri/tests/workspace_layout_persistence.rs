use mach_terminal_lib::models::{
    RestorableSession, SplitNodeSnapshot, TabGroupSnapshot, WorkspaceLayout, WorkspacePaneSnapshot,
    WORKSPACE_LAYOUT_SCHEMA_VERSION,
};
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
        sessions: vec![RestorableSession {
            session_id: "session-a".to_string(),
            shell: "wsl.exe".to_string(),
            args: vec!["-d".to_string(), "Ubuntu".to_string()],
            cwd: Some("/home/me".to_string()),
            name: Some("build".to_string()),
            chat_key: Some("chat-abc".to_string()),
            input_mode: Some("console".to_string()),
        }],
        groups: vec![],
        active_group_id: None,
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
    assert_eq!(loaded.sessions.len(), 1);
    assert_eq!(loaded.sessions[0].session_id, "session-a");
    assert_eq!(loaded.sessions[0].args, vec!["-d", "Ubuntu"]);
    assert_eq!(loaded.sessions[0].name.as_deref(), Some("build"));
}

#[test]
fn workspace_layout_without_sessions_field_loads_as_empty() {
    let temp = tempdir().expect("tempdir");
    let path = temp.path().join("legacy_workspace_layout.json");
    // A layout written by an older build: no `sessions` key at all.
    fs::write(
        &path,
        r#"{"schemaVersion":1,"rootPaneId":"pane-1","panes":[{"id":"pane-1","sessionId":null}],"activePaneId":"pane-1","splitDirection":"column"}"#,
    )
    .expect("write legacy");
    let loaded = load_workspace_layout_from_path(&path).expect("load").expect("some layout");
    assert!(loaded.sessions.is_empty());
}

#[test]
fn workspace_layout_tree_group_round_trip() {
    let temp = tempdir().expect("tempdir");
    let path = temp.path().join("workspace_layout_v2.json");
    let layout = WorkspaceLayout {
        schema_version: WORKSPACE_LAYOUT_SCHEMA_VERSION,
        root_pane_id: "pane-1".to_string(),
        panes: vec![WorkspacePaneSnapshot {
            id: "pane-1".to_string(),
            session_id: Some("session-a".to_string()),
        }],
        active_pane_id: "pane-1".to_string(),
        split_direction: "column".to_string(),
        sessions: vec![],
        groups: vec![TabGroupSnapshot {
            id: "group-1".to_string(),
            primary_session_id: "session-a".to_string(),
            panes: vec![],
            active_pane_id: "pane-2".to_string(),
            split_direction: "column".to_string(),
            layout: Some(SplitNodeSnapshot {
                kind: "split".to_string(),
                id: "split-1".to_string(),
                session_id: None,
                direction: Some("column".to_string()),
                ratio: Some(0.5),
                first: Some(Box::new(SplitNodeSnapshot {
                    kind: "pane".to_string(),
                    id: "pane-1".to_string(),
                    session_id: Some("session-a".to_string()),
                    direction: None,
                    ratio: None,
                    first: None,
                    second: None,
                })),
                second: Some(Box::new(SplitNodeSnapshot {
                    kind: "pane".to_string(),
                    id: "pane-2".to_string(),
                    session_id: Some("session-b".to_string()),
                    direction: None,
                    ratio: None,
                    first: None,
                    second: None,
                })),
            }),
            target_pane_id: Some("pane-2".to_string()),
            broadcast_mode: Some("off".to_string()),
        }],
        active_group_id: Some("group-1".to_string()),
    };

    save_workspace_layout_to_path(&path, &layout).expect("save");
    let loaded = load_workspace_layout_from_path(&path).expect("load").expect("some layout");
    assert_eq!(loaded.schema_version, 2);
    assert_eq!(loaded.groups.len(), 1);
    let group = &loaded.groups[0];
    assert_eq!(group.target_pane_id.as_deref(), Some("pane-2"));
    let tree = group.layout.as_ref().expect("tree layout");
    assert_eq!(tree.kind, "split");
    assert_eq!(tree.ratio, Some(0.5));
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
