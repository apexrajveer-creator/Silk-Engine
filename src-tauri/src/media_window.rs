//! Focus an existing window for the current media source. Never execute a path or URL from the UI.
#[cfg(windows)]
pub fn process_path(pid: u32) -> Option<String> {
    use windows::{core::PWSTR, Win32::{Foundation::CloseHandle, System::Threading::*}};
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 4096]; let mut len = buf.len() as u32;
        let result = QueryFullProcessImageNameW(process, PROCESS_NAME_FORMAT(0), PWSTR(buf.as_mut_ptr()), &mut len);
        let _ = CloseHandle(process);
        result.ok()?; Some(String::from_utf16_lossy(&buf[..len as usize]))
    }
}
pub fn match_score(source: &str, title: &str, window_app: &str, window_title: &str) -> u32 {
    if source.is_empty() || !source.eq_ignore_ascii_case(window_app) { return 0; }
    let title = title.trim().to_lowercase(); let window_title = window_title.to_lowercase();
    1 + if title.len() >= 3 && window_title.contains(&title) { 100 } else { 0 }
}
#[cfg(windows)]
pub fn focus(source: &str, title: &str) -> Result<(), String> {
    use windows::core::BOOL;
    use windows::Win32::{Foundation::{HWND, LPARAM}, UI::WindowsAndMessaging::*};
    struct Search<'a> { source: &'a str, title: &'a str, best: Option<(HWND,u32)> }
    unsafe fn window_app(hwnd: HWND) -> Option<String> {
        use windows::core::GUID;
        use windows::Win32::Foundation::PROPERTYKEY;
        use windows::Win32::System::Com::{CoTaskMemFree, StructuredStorage::{PropVariantToStringAlloc, PropVariantClear}};
        use windows::Win32::UI::Shell::PropertiesSystem::{IPropertyStore, SHGetPropertyStoreForWindow};
        let store: IPropertyStore = SHGetPropertyStoreForWindow(hwnd).ok()?;
        let key = PROPERTYKEY { fmtid: GUID::from_u128(0x9f4c2855_9f79_4b39_a8d0_e1d42de1d5f3), pid: 5 };
        let mut prop = store.GetValue(&key).ok()?;
        let text = PropVariantToStringAlloc(&prop).ok();
        let _ = PropVariantClear(&mut prop);
        let text = text?; let result = text.to_string().ok(); CoTaskMemFree(Some(text.0.cast()));
        result.filter(|value| !value.is_empty()).map(|value| crate::media::app_label(&value))
    }
    unsafe extern "system" fn visit(hwnd: HWND, param: LPARAM) -> BOOL {
        let search = &mut *(param.0 as *mut Search<'_>);
        if !IsWindowVisible(hwnd).as_bool() { return BOOL(1); }
        let mut text = [0u16; 1024]; let n = GetWindowTextW(hwnd, &mut text);
        if n <= 0 { return BOOL(1); }
        let mut pid = 0; GetWindowThreadProcessId(hwnd, Some(&mut pid));
        let title = String::from_utf16_lossy(&text[..n as usize]);
        let mut score = process_path(pid).map(|path| match_score(search.source, search.title, &crate::media::app_label(&path), &title)).unwrap_or(0);
        if score == 0 { score = window_app(hwnd).map(|label| match_score(search.source, search.title, &label, &title)).unwrap_or(0); }
        if score > search.best.map(|v| v.1).unwrap_or(0) { search.best = Some((hwnd,score)); }
        BOOL(1)
    }
    unsafe {
        let mut search = Search { source, title, best: None };
        EnumWindows(Some(visit), LPARAM(&mut search as *mut _ as isize)).map_err(|e| e.to_string())?;
        let (hwnd,_) = search.best.ok_or("The player's window could not be found. Open it from the taskbar.")?;
        if IsIconic(hwnd).as_bool() { let _ = ShowWindowAsync(hwnd, SW_RESTORE); }
        if !SetForegroundWindow(hwnd).as_bool() { return Err("Windows prevented focusing the player. Open it from the taskbar.".into()); }
        Ok(())
    }
}
#[cfg(not(windows))] pub fn focus(_: &str,_:&str)->Result<(),String>{Err("Only available on Windows".into())}
#[cfg(test)] mod tests { use super::*; #[test] fn correct_player_and_title_win(){ assert_eq!(match_score("Spotify","Track","Chrome","Track"),0); assert_eq!(match_score("Google Chrome","Track","Google Chrome","Track - YouTube"),101); assert_eq!(match_score("Google Chrome","Track","Google Chrome","Inbox"),1); } }
