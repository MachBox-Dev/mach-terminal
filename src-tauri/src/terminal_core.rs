use portable_pty::native_pty_system;
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct RuntimeCapabilities {
    pub pty_backend: &'static str,
    pub plugin_host: bool,
    pub provider_host: bool,
    pub session_persistence: bool,
    pub provider_routing: bool,
}

pub fn capabilities() -> RuntimeCapabilities {
    let _ = native_pty_system();

    RuntimeCapabilities {
        pty_backend: "portable-pty",
        plugin_host: true,
        provider_host: true,
        session_persistence: true,
        provider_routing: true,
    }
}
