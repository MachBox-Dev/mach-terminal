//! Environment block assembly for PTY child processes.

use std::collections::HashMap;

/// Process env plus optional profile overrides. On Windows, PATH is refreshed from registry.
pub fn build_child_environment(profile_env: HashMap<String, String>) -> HashMap<String, String> {
    #[cfg(windows)]
    {
        return crate::win_env::build_child_environment(profile_env);
    }
    #[cfg(not(windows))]
    {
        let mut env: HashMap<String, String> = std::env::vars().collect();
        if env.get("TERM").map_or(true, |v| v.trim().is_empty()) {
            env.insert("TERM".to_string(), "xterm-256color".to_string());
        }
        if env.get("COLORTERM").map_or(true, |v| v.trim().is_empty()) {
            env.insert("COLORTERM".to_string(), "truecolor".to_string());
        }
        env.insert("TERM_PROGRAM".to_string(), "mach-terminal".to_string());
        for (key, value) in profile_env {
            env.insert(key, value);
        }
        env
    }
}
