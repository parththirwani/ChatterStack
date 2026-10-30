# Auth service

This directory is reserved for the identity service. During the first layout
checkpoint, OAuth callbacks and database sessions still run in `apps/web`.
The next migration step will move sign-in and session validation here behind a
stable identity API. No auth traffic should be routed to this package yet.

Auth will own users, OAuth accounts, sessions, and verification tokens. Other
services will receive a user ID through a validated identity token and will
not query auth tables directly.
