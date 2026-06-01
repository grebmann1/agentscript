# Agentforce Compatibility Matrix

| Capability | Agentforce API | This server | Notes |
|---|---|---|---|
| Start session | `/einstein/ai-agent/v1/agents/{agentId}/sessions` | Supported | Matching lifecycle path |
| Send message (sync) | `/einstein/ai-agent/v1/sessions/{sessionId}/messages` | Supported | Matching lifecycle path |
| Send message (stream) | `/einstein/ai-agent/v1/sessions/{sessionId}/messages/stream` | Supported | SSE chunks normalized |
| End session | `DELETE /einstein/ai-agent/v1/sessions/{sessionId}` | Supported | Matching lifecycle path |
| Submit feedback | `/einstein/ai-agent/v1/sessions/{sessionId}/messages/{messageId}/feedback` | Supported | Matching lifecycle path |
| Session persistence | Platform-managed | Configurable store | `memory` default, optional `postgres` |
| Auth | Salesforce access token | Bearer token allowlist | `API_AUTH_TOKENS` |
| Legacy API | N/A | `/v1/*` aliases (deprecated) | Temporary migration bridge |

Intentional deviations:
- Runtime agent execution remains process-local even when session records are persisted.
- Request/response envelope is Agentforce-shaped, not byte-for-byte identical.
