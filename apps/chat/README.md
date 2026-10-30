# Chat execution service

This directory is reserved for the chat execution service. During the first
layout checkpoint, `/api/chat`, model calls, and AI Council still run in
`apps/web`. No chat traffic should be routed to this package yet.

The service will own prompt assembly, model calls, AI Council, and response
streaming. It will use backend APIs for authorized conversation data, skills,
documents, retrieval, and message persistence. It will not write application
tables directly.
