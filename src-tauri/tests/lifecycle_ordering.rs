use mach_terminal_lib::session_manager::can_transition_status;

#[test]
fn running_can_transition_to_terminal_states() {
    assert!(can_transition_status("running", "stopped"));
    assert!(can_transition_status("running", "closed"));
    assert!(can_transition_status("running", "error"));
}

#[test]
fn terminal_states_are_monotonic() {
    assert!(!can_transition_status("closed", "stopped"));
    assert!(!can_transition_status("stopped", "closed"));
    assert!(!can_transition_status("error", "running"));
}

#[test]
fn duplicate_status_transitions_are_ignored() {
    assert!(!can_transition_status("running", "running"));
    assert!(!can_transition_status("closed", "closed"));
}
