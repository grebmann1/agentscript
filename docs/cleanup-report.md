# Cleanup Report: `feat/js-runtime` Branch

Audit date: 2026-05-13
Scope: `packages/runtime/`, `packages/runtime-vercel/`, `apps/ui/` additions

---

## 1. Dead Exports (`packages/runtime/src/index.ts`)

### 1.1 `compileExpr` — never consumed externally or in tests

- **File:** `packages/runtime/src/index.ts`, line 33
- **Issue:** `compileExpr` is exported publicly but is never imported by any consumer (runtime-vercel, UI app, or any test file). It is only used internally by `evalExpr` within `src/expr/eval.ts`.
- **Recommendation:** Remove from public exports. If needed for advanced use cases, document and add a test.
- **Priority:** MEDIUM

### 1.2 `EvalScope` type — no external consumer

- **File:** `packages/runtime/src/index.ts`, line 34
- **Issue:** The `EvalScope` type is exported but never imported by any consumer or test.
- **Recommendation:** Remove from public exports unless planned for use.
- **Priority:** LOW

### 1.3 `MiddlewarePipeline` — exported but internal-only

- **File:** `packages/runtime/src/index.ts`, line 49
- **Issue:** `MiddlewarePipeline` is exported publicly but never used by any consumer. It is only used internally by the `Runtime` class. The `Middleware` type is sufficient for users.
- **Recommendation:** Remove from public exports. The class is an implementation detail; users configure middleware via `RuntimeOptions.middleware[]`.
- **Priority:** MEDIUM

### 1.4 `CheckpointIncompatibleError` — exported, never thrown or caught

- **File:** `packages/runtime/src/index.ts`, line 73
- **Issue:** Exported but never used in any test or external consumer. `CheckpointVersionError` is tested, but `CheckpointIncompatibleError` is dead.
- **Recommendation:** Verify if this error is actually thrown anywhere in `src/`. If not, remove. If it is future-facing, add a test.
- **Priority:** LOW

### 1.5 `TracingContext`, `generateTraceId`, `generateSpanId`, `ConsoleSpanExporter`, `OtlpJsonSpanExporter`, `TracingOptions` — no external consumers

- **File:** `packages/runtime/src/index.ts`, lines 94-109
- **Issue:** These are exported but none are imported by runtime-vercel, the UI app, or tests (except `InMemorySpanExporter` and `MultiSpanExporter` which ARE tested). They form a public tracing API with zero adoption.
- **Recommendation:** Keep the exports (they form a coherent public API) but add at least one integration test for `ConsoleSpanExporter` and `OtlpJsonSpanExporter` to prevent rot. Alternatively, add a `@public` / `@beta` annotation.
- **Priority:** LOW

### 1.6 `loadGraph` / `LoadedGraph` — internal implementation exposed

- **File:** `packages/runtime/src/index.ts`, lines 30-31
- **Issue:** `loadGraph` is exported publicly but is only used internally by `Runtime`. No external consumer or test imports it.
- **Recommendation:** Remove from public exports. This is a build-time IR transformation that users should not need to call directly.
- **Priority:** MEDIUM

### 1.7 `evalExpr`, `renderTemplate`, `isTemplate` — no external use

- **File:** `packages/runtime/src/index.ts`, lines 33, 35
- **Issue:** These expression and template utilities are exported but never consumed externally. They are internal plumbing used by `run-steps.ts` and `runtime.ts`.
- **Recommendation:** Remove from public exports unless there is a planned "scripting toolkit" use case.
- **Priority:** MEDIUM

---

## 2. Duplicate/Redundant Code

### 2.1 Gateway-tests: inline mock LLM drivers duplicate harness pattern

- **Files:**
  - `packages/runtime-vercel/examples/gateway-tests/test-parallel-tools.ts`, lines 127-172
  - `packages/runtime-vercel/examples/gateway-tests/test-parallel-timing.ts`, lines 93-126
- **Issue:** Both files construct `VercelAiSdkDriver` instances inline with custom `mockGenerateText` functions, even though the harness already provides `createLlmDriver`. The mock-LLM pattern (step counter + predetermined responses) is duplicated verbatim between them.
- **Recommendation:** Add a `createMockLlmDriver(script)` helper to `harness.ts` that accepts a sequence of mock responses. Both tests can then use it, reducing ~80 lines of duplication.
- **Priority:** MEDIUM

### 2.2 `tracing/index.ts` barrel file duplicates `src/index.ts` exports

- **File:** `packages/runtime/src/tracing/index.ts`
- **Issue:** This barrel file re-exports exactly the same tracing symbols as `src/index.ts` lines 94-108. It is never imported by any file in the repo. The documentation references `@agentscript/runtime/tracing` but the `package.json` does not define that sub-path export, so the barrel is dead code.
- **Recommendation:** Either (a) remove the barrel, or (b) add a sub-path export in `package.json` for `"./tracing"` and update imports in documentation to match.
- **Priority:** MEDIUM

---

## 3. Unused Dependencies

### 3.1 `@agentscript/compiler` in `runtime-vercel` dependencies — redundant

- **File:** `packages/runtime-vercel/package.json`, line 37
- **Issue:** `@agentscript/compiler` is listed as a production dependency, but the only import is `import type { AgentDSLAuthoring }` in `src/agent.ts` (line 14). Since this is a type-only import, it contributes zero runtime bytes. Additionally, `@agentscript/runtime` already depends on it, so it will be installed transitively.
- **Recommendation:** Move to `devDependencies` or remove entirely. The type will still resolve through `@agentscript/runtime`.
- **Priority:** LOW

### 3.2 All runtime-vercel devDependencies are correctly placed

- `@ai-sdk/anthropic`, `@ai-sdk/openai`: used only in `examples/`
- `ai`: peer dependency (correct)
- `tsx`: used for `"example"` script
- No issues found here.

---

## 4. Dead Test Helpers

### 4.1 `ScriptedLlm` is universally adopted - no duplication found

- **File:** `packages/runtime/test/helpers.ts`
- **Issue:** None. All 17 test files that need an LLM import `ScriptedLlm` from `helpers.ts`. The only test that doesn't (`mock-adapter.test.ts`) tests tool adapters and doesn't need an LLM at all.
- **Recommendation:** No action needed.
- **Priority:** N/A

### 4.2 `autoLoadTestScripts` is exported but never called

- **File:** `apps/ui/src/lib/dev-helpers.ts`, line 58
- **Issue:** `autoLoadTestScripts()` is exported but never imported or called anywhere in the codebase. `main.tsx` only imports `initDevEnvironment` and `seedDefaultAgents`.
- **Recommendation:** Remove the unused export, or wire it into the app if it was intended.
- **Priority:** LOW

### 4.3 `load-test-scripts.ts` — stub file with 5 no-op exports

- **File:** `apps/ui/src/lib/load-test-scripts.ts`
- **Issue:** All 5 exported functions are no-ops (return empty arrays/null/void). The file explicitly notes "not available in the open-source build." While `loadTestScriptsIfNeeded` and `loadAllTestScripts` are imported by `dev-helpers.ts`, `loadSpecificTestScript`, `hasTestScriptsLoaded`, and `getAvailableTestScripts` are never referenced anywhere.
- **Recommendation:** Remove the 3 unused no-op exports. Keep the 2 that are imported as placeholders for the internal build.
- **Priority:** LOW

---

## 5. Stale Comments / TODOs

No `TODO`, `FIXME`, `HACK`, or `XXX` comments were found in:
- `packages/runtime/src/`
- `packages/runtime-vercel/src/`
- `packages/runtime/test/`
- `packages/runtime-vercel/examples/`
- `packages/runtime-vercel/test/`

The codebase is clean in this regard.

---

## 6. Dialect Coupling

### 6.1 `compileSource` re-export hardcodes Agentforce dialect

- **File:** `packages/runtime-vercel/src/index.ts`, lines 29-30
- **Issue:** The package re-exports `compileSource` directly from `@agentscript/agentforce`, which hardcodes the Agentforce dialect (YAML-like DSL). The comment on lines 26-28 acknowledges this ("We intentionally narrow the surface...") but there is no documentation or type-level indicator that this is dialect-specific.
- **Recommendation:** Add a `@remarks` JSDoc note or a section in README.md stating this convenience re-export is Agentforce-only. Users targeting other dialects should import from the appropriate dialect package and pass the compiled `AgentDSLAuthoring` doc directly to `createAgent()`.
- **Priority:** LOW (the design is intentional; just needs documentation)

### 6.2 No other dialect assumptions in runtime core

- The `@agentscript/runtime` package itself is dialect-agnostic. It accepts any `AgentDSLAuthoring` document (the IR type from `@agentscript/compiler`). No hardcoded dialect references exist in `packages/runtime/src/`.
- **Recommendation:** No action needed.
- **Priority:** N/A

---

## 7. Unused UI Code

### 7.1 All example .agent files are referenced

- **File:** `apps/ui/src/lib/examples/index.ts`
- **Issue:** None. All 6 `.agent` files in the `examples/` directory are imported and used in `EXAMPLE_SCRIPTS`.
- **Priority:** N/A

### 7.2 `test-mcp-server.ts` — development utility in app root

- **File:** `apps/ui/test-mcp-server.ts`
- **Issue:** This is a standalone test server (not included in any build or script in `package.json`). It is a useful dev utility but could confuse newcomers.
- **Recommendation:** Consider moving to a `scripts/` or `test/` directory and adding a note in package.json scripts.
- **Priority:** LOW

---

## 8. Console.log in Library Source

### 8.1 No issues found

- `packages/runtime/src/`: Zero `console.log` calls. `console.warn` in `ConsoleSpanExporter` is intentional (that is the exporter's purpose).
- `packages/runtime-vercel/src/`: The only occurrence is in a JSDoc code example (line 138 of `agent.ts`): `onStepFinish: step => console.log(step.node)`. This is documentation, not executed code.
- **Priority:** N/A

---

## 9. `.js` vs `.ts` Extension Imports

### 9.1 No issues found

- All internal imports in `packages/runtime/src/` and `packages/runtime-vercel/src/` use `.js` extensions (correct for ESM with TypeScript compilation).
- No `.ts` extension imports were found in source or test files.
- **Priority:** N/A

---

## 10. Leftover Debug Code

### 10.1 `packages/runtime/test/manual/parallel-e2e.ts` — manual test with ANSI color helpers

- **File:** `packages/runtime/test/manual/parallel-e2e.ts`
- **Issue:** This 560+ line file is a manual integration test that starts real HTTP/MCP servers. It includes ANSI color constants and `console.log` calls. It is NOT run by `vitest` (no `.test.ts` suffix). Its purpose is documented ("Manual integration test").
- **Recommendation:** Fine as-is for manual verification. Consider adding a comment to `package.json` scripts or a `test:manual` script so it's discoverable.
- **Priority:** LOW

### 10.2 Documentation references non-existent sub-path export

- **File:** `docs/architecture/02-advanced-features.md`, lines 344, 419, 434
- **Issue:** Documentation imports from `@agentscript/runtime/tracing` but the package.json only exports `"."`. This means anyone following the docs would get a module resolution error.
- **Recommendation:** Either add a sub-path export `"./tracing"` to `packages/runtime/package.json` pointing to the `tracing/index.ts` barrel, or update the documentation to import from the main entry point.
- **Priority:** HIGH (misleading documentation that causes import failures)

### 10.3 `.claude/` directory is untracked

- **File:** `.claude/` (shown in git status)
- **Issue:** This appears to be a Claude Code configuration directory that was created during development. It should either be gitignored or committed intentionally.
- **Recommendation:** Add `.claude/` to `.gitignore` unless it contains project-level settings meant to be shared.
- **Priority:** LOW

---

## Summary by Priority

| Priority | Count | Key Items |
|----------|-------|-----------|
| HIGH     | 1     | Documentation references non-existent sub-path export |
| MEDIUM   | 6     | Dead public exports (`compileExpr`, `MiddlewarePipeline`, `loadGraph`, `evalExpr`/`renderTemplate`/`isTemplate`), duplicate mock LLM pattern in gateway-tests, orphaned `tracing/index.ts` barrel |
| LOW      | 8     | Redundant dep, unused helpers, test server location, dialect docs, etc. |

---

## Recommended Actions (ordered by impact)

1. **Fix the sub-path export mismatch** (HIGH): Either add `"./tracing"` to `exports` in `packages/runtime/package.json` or update the architecture docs.

2. **Trim public API surface** (MEDIUM): Remove `compileExpr`, `loadGraph`, `evalExpr`, `renderTemplate`, `isTemplate`, `MiddlewarePipeline` from `packages/runtime/src/index.ts`. These are internal implementation details that leak into the public API and increase the surface users must understand.

3. **Refactor gateway-test mock LLMs** (MEDIUM): Add `createMockLlmDriver(steps)` to `harness.ts` and simplify `test-parallel-tools.ts` and `test-parallel-timing.ts`.

4. **Resolve `tracing/index.ts`** (MEDIUM): Delete the barrel file or wire it up as a sub-path export. Currently it serves no purpose.

5. **Clean up minor dead code** (LOW): `autoLoadTestScripts`, unused `load-test-scripts.ts` exports, `CheckpointIncompatibleError`.
