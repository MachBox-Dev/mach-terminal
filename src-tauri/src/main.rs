// Keep Explorer-launched GUI builds, including QA builds, from opening a console.
#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

fn main() {
    mach_terminal_lib::run()
}
