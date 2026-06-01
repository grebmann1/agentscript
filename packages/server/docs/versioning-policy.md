# API Versioning Policy

- Primary contract namespace: `/einstein/ai-agent/v1/*`.
- Backward-incompatible changes require a new versioned namespace.
- Additive fields/endpoints may be introduced within `v1`.
- Deprecated fields/endpoints must include migration notes and sunset timeline.
- `/v1/*` legacy aliases are transitional and not part of long-term compatibility guarantees.
