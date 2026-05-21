# Multi-window, one purpose per window

The app uses one Electron `BrowserWindow` per surface — the **PR Inbox** is one window, each open PR Review is its own window, each **Local Mode** invocation from the CLI spawns its own window. There are no top-level tabs.

We chose this over a tabbed single-window model because code review is a multi-monitor activity: users want the inbox on one screen and an open PR on another, and tabs make that awkward. Each window also owns its own **Pending Review** and view state without cross-talk, which matches the mental model "one window = one thing I'm reading." The cost is no built-in "back/forward" between surfaces — fine, because navigation between them goes through OS window management.
