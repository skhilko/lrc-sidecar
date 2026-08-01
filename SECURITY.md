# Security policy

Report vulnerabilities privately to the repository owner rather than opening a public issue.

Supported releases are the latest tagged release. Security-sensitive invariants include no audio mutation, no existing-sidecar replacement, root containment, bounded HTTPS provider access, disabled SQLite extensions, and omission of lyric bodies from logs/state.

Before reporting a safe-write failure, include the filesystem type and mount options. Do not attach copyrighted audio or lyric content; minimal generated fixtures and redacted logs are sufficient.
