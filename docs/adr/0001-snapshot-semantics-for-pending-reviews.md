# Snapshot semantics for Pending Reviews

When a user starts a **Pending Review** against a mutating **Diff Source** (e.g. the working tree), the diff is captured as a **Diff Snapshot** and **Line Comments** anchor to that snapshot rather than to live file content. To re-examine after edits, the user explicitly "refreshes," which warns that anchored comments may not survive.

We chose this over GitHub-style content-anchoring (which re-locates comments across edits and marks them "Outdated") because robust anchoring is its own engineering project and the failure mode of bad anchoring is worse than the inconvenience of explicit refreshes. Snapshot semantics also match the agent-review workflow correctly: feedback is about the output the agent produced *at that moment*; if the agent iterates, the human starts a new review.
