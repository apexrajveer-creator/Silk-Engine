//! The island's Power tab: sleep, lock, sign out, restart, shut down.
//!
//! The webview only ever sends one of five fixed words, never a command line, and anything that ends the user's session
//! (sign out, restart, shut down) is refused unless the user has confirmed it in the interface; the interface asks for a second
//! tap first. What each action runs is decided here, from a fixed table.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PowerAction {
    Sleep,
    Lock,
    SignOut,
    Restart,
    Shutdown,
}

pub const ALL: [PowerAction; 5] = [PowerAction::Sleep, PowerAction::Lock, PowerAction::SignOut, PowerAction::Restart, PowerAction::Shutdown];

impl PowerAction {
    pub fn id(self) -> &'static str {
        match self {
            PowerAction::Sleep => "sleep",
            PowerAction::Lock => "lock",
            PowerAction::SignOut => "signout",
            PowerAction::Restart => "restart",
            PowerAction::Shutdown => "shutdown",
        }
    }

    /// Exact match only: no trimming, no case folding, nothing "close enough".
    pub fn parse(s: &str) -> Option<PowerAction> {
        ALL.into_iter().find(|a| a.id() == s)
    }

    /// Ends the user's session, so it needs a confirmation.
    pub fn is_destructive(self) -> bool {
        matches!(self, PowerAction::SignOut | PowerAction::Restart | PowerAction::Shutdown)
    }
}

/// The external program that performs an action, for the ones that use one. Fixed text only.
pub fn command_for(a: PowerAction) -> Option<(&'static str, &'static [&'static str])> {
    match a {
        PowerAction::Restart => Some(("shutdown", &["/r", "/t", "0"])),
        PowerAction::Shutdown => Some(("shutdown", &["/s", "/t", "0"])),
        _ => None,
    }
}

pub fn authorize(a: PowerAction, confirmed: bool) -> Result<(), String> {
    if a.is_destructive() && !confirmed {
        Err("This ends your session, so it has to be confirmed first".into())
    } else {
        Ok(())
    }
}

/// Parse, check the confirmation and run. The only entry point the commands use.
pub fn perform(id: &str, confirmed: bool) -> Result<(), String> {
    let a = PowerAction::parse(id).ok_or_else(|| "Unknown power action".to_string())?;
    authorize(a, confirmed)?;
    execute(a)
}

#[cfg(windows)]
fn execute(a: PowerAction) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    use windows::Win32::System::Power::SetSuspendState;
    use windows::Win32::System::Shutdown::{ExitWindowsEx, LockWorkStation, EWX_LOGOFF, SHUTDOWN_REASON};
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    match a {
        PowerAction::Lock => unsafe { LockWorkStation() }.map_err(|e| e.to_string()),
        // `false` = sleep, not hibernate
        PowerAction::Sleep => {
            if unsafe { SetSuspendState(false, false, false) } {
                Ok(())
            } else {
                Err("Windows did not go to sleep".into())
            }
        }
        PowerAction::SignOut => unsafe { ExitWindowsEx(EWX_LOGOFF, SHUTDOWN_REASON(0)) }.map_err(|e| e.to_string()),
        PowerAction::Restart | PowerAction::Shutdown => {
            let (program, args) = command_for(a).ok_or("No command")?;
            std::process::Command::new(program).args(args).creation_flags(CREATE_NO_WINDOW).spawn().map(|_| ()).map_err(|e| e.to_string())
        }
    }
}

#[cfg(not(windows))]
fn execute(_a: PowerAction) -> Result<(), String> {
    Err("Power actions are only available on Windows".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_action_has_a_unique_id_that_parses_back() {
        let mut seen = std::collections::HashSet::new();
        for a in ALL {
            assert!(seen.insert(a.id()), "duplicate id {}", a.id());
            assert_eq!(PowerAction::parse(a.id()), Some(a));
        }
        assert_eq!(seen.len(), 5);
    }
    #[test]
    fn parsing_is_exact() {
        for bad in ["", "Sleep", "SLEEP", " sleep", "sleep ", "shutdown /s", "sleep;shutdown", "hibernate", "reboot", "log off", "\0", "slеep"] {
            assert_eq!(PowerAction::parse(bad), None, "{bad:?}");
        }
    }
    #[test]
    fn only_the_actions_that_end_the_session_are_destructive() {
        assert!(!PowerAction::Sleep.is_destructive() && !PowerAction::Lock.is_destructive());
        assert!(PowerAction::SignOut.is_destructive() && PowerAction::Restart.is_destructive() && PowerAction::Shutdown.is_destructive());
    }
    #[test]
    fn a_destructive_action_is_refused_without_confirmation() {
        for a in [PowerAction::SignOut, PowerAction::Restart, PowerAction::Shutdown] {
            assert!(authorize(a, false).is_err(), "{a:?}");
            assert!(authorize(a, true).is_ok(), "{a:?}");
        }
        for a in [PowerAction::Sleep, PowerAction::Lock] {
            assert!(authorize(a, false).is_ok(), "{a:?} is harmless");
        }
    }
    #[test]
    fn nothing_is_performed_for_an_unknown_word_or_an_unconfirmed_shutdown() {
        assert!(perform("format-c", true).unwrap_err().contains("Unknown"));
        assert!(perform("shutdown", false).unwrap_err().contains("confirmed"));
        assert!(perform("restart", false).unwrap_err().contains("confirmed"));
        assert!(perform("signout", false).unwrap_err().contains("confirmed"));
    }
    #[test]
    fn restart_and_shutdown_run_a_fixed_command_with_no_delay() {
        assert_eq!(command_for(PowerAction::Restart), Some(("shutdown", &["/r", "/t", "0"][..])));
        assert_eq!(command_for(PowerAction::Shutdown), Some(("shutdown", &["/s", "/t", "0"][..])));
        for a in [PowerAction::Sleep, PowerAction::Lock, PowerAction::SignOut] {
            assert_eq!(command_for(a), None);
        }
    }
    #[test]
    fn the_fixed_commands_contain_nothing_a_shell_could_misread() {
        for a in ALL {
            if let Some((program, args)) = command_for(a) {
                for part in std::iter::once(&program).chain(args.iter()) {
                    assert!(part.chars().all(|c| c.is_ascii_alphanumeric() || c == '/'), "{part}");
                }
            }
        }
    }
}
