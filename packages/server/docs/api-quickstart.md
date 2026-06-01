# API Quickstart

Base path:

`https://<host>/einstein/ai-agent/v1`

Required header:

`Authorization: Bearer <token>`

## 1) Start a session

```bash
curl -X POST "https://<host>/einstein/ai-agent/v1/agents/support/sessions" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"externalSessionKey":"demo-1"}'
```

### Optional: seed mutable state on the session

Pass a `context` object whose keys match `mutable` variables in the agent.
Each match seeds the runtime state before the first turn — this is what
fires deterministic `before_reasoning` / `after_reasoning`
`run @actions.X` blocks on turn 1 without needing the LLM to call any tool.

```bash
curl -X POST "https://<host>/einstein/ai-agent/v1/agents/support/sessions" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
        "externalSessionKey": "demo-1",
        "context": {
          "customer_email": "alice@example.com",
          "order_number":   "ORD-12345"
        }
      }'
```

Internal-visibility (`mutable`) variables are writable via `context`;
linked (`Context`) variables are read-only and ignored if supplied.

## 2) Send a synchronous message

```bash
curl -X POST "https://<host>/einstein/ai-agent/v1/sessions/<sessionId>/messages" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"message":{"sequenceId":1,"type":"Text","text":"Hello"}}'
```

## 3) Send a streaming message (SSE)

```bash
curl -N -X POST "https://<host>/einstein/ai-agent/v1/sessions/<sessionId>/messages/stream" \
  -H "Authorization: Bearer <token>" \
  -H "Accept: text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"message":{"sequenceId":2,"type":"Text","text":"Stream this"}}'
```

## 4) End the session

```bash
curl -X DELETE "https://<host>/einstein/ai-agent/v1/sessions/<sessionId>" \
  -H "Authorization: Bearer <token>"
```

## Landing page demo API (same-origin)

For the public website demo, the UI uses constrained same-origin endpoints:

- `POST /demo/agent/session`
- `POST /demo/agent/session/:sessionId/message` with body `{ "text": "..." }`
- `DELETE /demo/agent/session/:sessionId`

These endpoints are fixed to the built-in `multi_step_support` agent and are intended for visitor testing.
