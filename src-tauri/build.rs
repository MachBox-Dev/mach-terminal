use std::env;
use std::fs;
use std::path::PathBuf;

fn ensure_mcp_sidecar_placeholder() {
    let Ok(target) = env::var("TARGET") else {
        return;
    };
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let bin_dir = manifest_dir.join("bin");
    let _ = fs::create_dir_all(&bin_dir);
    let ext = if target.contains("windows") { ".exe" } else { "" };
    let sidecar = bin_dir.join(format!("mach-terminal-mcp-{target}{ext}"));
    if !sidecar.exists() {
        let _ = fs::write(&sidecar, b"");
    }
}

fn main() {
    ensure_mcp_sidecar_placeholder();
    tauri_build::build()
}

