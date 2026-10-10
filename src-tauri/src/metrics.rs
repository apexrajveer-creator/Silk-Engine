//! Low-frequency system readings for widgets; queried only while relevant widgets are visible.
#[cfg(windows)]
pub fn sample() -> serde_json::Value {
    use std::sync::Mutex;
    #[repr(C)]
    #[derive(Default)]
    struct FileTime {
        low: u32,
        high: u32,
    }
    impl FileTime {
        fn ticks(&self) -> u64 {
            ((self.high as u64) << 32) | self.low as u64
        }
    }
    #[repr(C)]
    #[derive(Default)]
    struct MemoryStatus {
        length: u32,
        load: u32,
        total: u64,
        avail: u64,
        page_total: u64,
        page_avail: u64,
        virtual_total: u64,
        virtual_avail: u64,
        extended: u64,
    }
    #[allow(non_snake_case)]
    #[link(name = "kernel32")]
    extern "system" {
        fn GetSystemTimes(idle: *mut FileTime, kernel: *mut FileTime, user: *mut FileTime) -> i32;
        fn GlobalMemoryStatusEx(status: *mut MemoryStatus) -> i32;
        fn GetTickCount64() -> u64;
    }
    static PREVIOUS: Mutex<Option<(u64, u64)>> = Mutex::new(None);
    let mut idle = FileTime::default();
    let mut kernel = FileTime::default();
    let mut user = FileTime::default();
    let mut cpu = None;
    unsafe {
        if GetSystemTimes(&mut idle, &mut kernel, &mut user) != 0 {
            let total = kernel.ticks().saturating_add(user.ticks());
            let idle = idle.ticks();
            if let Ok(mut previous) = PREVIOUS.lock() {
                if let Some((old_total, old_idle)) = *previous {
                    let elapsed = total.saturating_sub(old_total);
                    if elapsed > 0 {
                        cpu = Some(
                            (100.0 * (1.0 - idle.saturating_sub(old_idle) as f64 / elapsed as f64))
                                .clamp(0.0, 100.0),
                        );
                    }
                }
                *previous = Some((total, idle));
            }
        }
        let mut memory = MemoryStatus {
            length: std::mem::size_of::<MemoryStatus>() as u32,
            ..Default::default()
        };
        let ram = if GlobalMemoryStatusEx(&mut memory) != 0 {
            Some(memory.load)
        } else {
            None
        };
        serde_json::json!({"cpu":cpu,"ram":ram,"uptime":GetTickCount64()/1000})
    }
}
#[cfg(not(windows))]
pub fn sample() -> serde_json::Value {
    serde_json::json!({"cpu":null,"ram":null,"uptime":0})
}
