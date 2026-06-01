# Go Live Checklist

- [ ] `launch-policy.md` approved by engineering + product.
- [ ] API auth enabled (`API_AUTH_TOKENS` configured in production).
- [ ] CORS allowlist configured (`CORS_ALLOWED_ORIGINS` not wildcard unless approved).
- [ ] Rate limits and request size caps enabled.
- [ ] Session backend selected (`memory` or `postgres`) and validated.
- [ ] `/healthz`, `/readyz`, `/metrics` monitored.
- [ ] Build + unit tests + smoke tests pass in CI.
- [ ] Staging verification includes session lifecycle, streaming, and feedback routes.
- [ ] Rollback procedure validated.
- [ ] Alias endpoint sunset date communicated for `/v1/*`.
