//! On Windows, a program without a window of its own (this app) that starts a console program such
//! as `git` makes a console window flash. Background commands go through `quiet()` to avoid it.

use std::process::Command;

pub trait Quiet {
    /// Runs the command without opening a console window (no effect outside Windows).
    fn quiet(&mut self) -> &mut Self;
}

impl Quiet for Command {
    #[cfg(target_os = "windows")]
    fn quiet(&mut self) -> &mut Self {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        self.creation_flags(CREATE_NO_WINDOW)
    }

    #[cfg(not(target_os = "windows"))]
    fn quiet(&mut self) -> &mut Self {
        self
    }
}
