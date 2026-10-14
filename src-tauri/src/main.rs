// Hide the console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Started by the crash handler (stability.rs): give the process that is ending a moment to release its locks.
    if std::env::args().any(|a| a == "--relaunch") {
        std::thread::sleep(std::time::Duration::from_secs(4));
    }
    silk_engine_lib::run()
}
