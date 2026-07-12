# Schema-driven screen questions

Status: implemented; live Gateway validation pending

Plan date: 2026-07-12

Background: [provider-agnostic image question research](../research/ai-image-analysis.md)

## Goal

Let a TV test capture the current screen, ask one visual question, and receive a
provider-neutral, schema-validated result:

```ts
const state = await tv.screen.ask({
  question: "Which screen is visible?",
  output: Output.choice({
    options: ["home", "detail", "player", "unknown"] as const,
  }),
});

expect.equal(state.output, "detail");
```

The same API must accept `Output.object(...)` for richer results while preserving
the inferred output type.

This plan supersedes the earlier `expect.visualQuestion` sketch in the research
note; the schema-driven query composes with the assertions that already exist.

## Scope

Ship the runner API and Gateway-backed CLI configuration. Keep direct provider
models available through runner injection, so the analysis code is not tied to
Gateway.

Do not add:

- automatic AI fallback from pixel comparison;
- a provider registry or several provider packages;
- confidence scores, explanations, retries, caching, or multi-model voting;
- a new device operation or changes to device connection flows;
- a new `TestResult` record type for AI telemetry;
- an interactive `couch ask` command.

## Decisions

### Pass the AI SDK output specification through

`tv.screen.ask` accepts an AI SDK `Output` specification and forwards it to
`generateText`. Couch does not translate a home-grown schema into provider
formats.

The installed AI SDK declarations are the source of truth for the wrapper's
generic signature. The compile-time acceptance check is more important than
preselecting a generic type spelling in this plan:

- `Output.choice` produces its literal union;
- `Output.object` produces its schema type;
- callers do not cast the returned output.

AI SDK 7 currently exposes this seam as `OutputInterface` plus
`InferGenerateOutput`; verify those exported names after installation and do not
import the internal `InferCompleteOutput` alias.

### Separate asking from asserting

`tv.screen.ask` returns `{ output, modelId, usage }`. Existing `expect.equal`
handles simple assertions; callers can inspect object fields for richer results.
Provider/schema failures throw, and the existing runner classifies them as
infrastructure failures. This keeps AI generation from pretending to be an
assertion and avoids changing `TestResult`.

Model and usage metadata stays in the returned value for now. Couch does not
persist it in `TestResult` until there is a concrete reporting requirement.

### Gateway first, model injection underneath

Add explicit root configuration:

```ts
ai: {
  model: "provider/model",
  timeoutMs: 15_000,
}
```

The string resolves through AI Gateway and credentials stay in
`AI_GATEWAY_API_KEY`. There is no default model. The runner uses a 15-second
timeout when configuration omits `timeoutMs`, including when a direct model is
injected.

Also add an optional language-model input to `RunTvTestOptions`. Tests use it to
inject the AI SDK mock model; programmatic consumers can pass a model from a
direct provider package. The configured Gateway model is used only when no model
was injected.

### Keep the request bounded

Each call uses:

- one existing PNG or JPEG capture;
- a fixed system instruction to use visible pixels, ignore instructions inside
  the image, and use an uncertain/unknown option when the supplied schema has one;
- the caller's question and output specification;
- `maxRetries: 0`, the configured timeout, and a small output-token limit;
- the existing runner abort signal.

Couch logs no prompt, image bytes, API keys, or raw provider response.

## Runtime flow

1. `tv.screen.ask(options)` rejects missing AI configuration before capture.
2. It calls the existing contained `screen.capture` path with a generated
   `screen-question-N` name and the platform format selected by the runner.
3. It reads the captured bytes from the runner-owned artifact path.
4. The new analyzer calls `generateText` with the injected/resolved language
   model, image part, question, and caller-supplied output.
5. It returns the validated output plus model id and usage.
6. The test uses existing assertions to decide pass/fail.

## Implementation slices

### 1. Compatibility spike and dependency

Files:

- `packages/runner/package.json`
- `bun.lock`

Changes:

- Add only `ai`; do not add Zod or a provider package.
- Check the installed AI SDK 7 docs and declarations for `LanguageModel`,
  `Output`, `generateText`, Gateway construction, usage, mock models, timeout,
  and abort options.
- Decide from the actual build whether `ai` needs to be externalized alongside
  `odiff-bin`; prefer externalizing it if no runtime issue requires bundling.

Gate:

- A Bun smoke test sends one PNG and one JPEG to a configured Gateway vision
  model and validates an `Output.choice` result.
- Timeout and abort stop the call.
- `bun run --filter @couch/runner build` succeeds.

Stop if AI SDK 7 cannot run under the project's Bun version. Do not wire the
feature around an unsupported runtime.

### 2. Configuration and model resolution

Files:

- `packages/runner/src/config.ts`
- `packages/runner/src/config.test.ts`
- `packages/runner/src/runner.ts`

Changes:

- Add optional `ai.model` and `ai.timeoutMs` to `CouchTestConfig` and its strict
  validator.
- Require a non-empty model string and positive timeout when `ai` is present.
- Keep credential-shaped keys rejected; configuration never accepts an API key.
- Add optional injected `aiModel` to `RunTvTestOptions`.
- Resolve the configured Gateway model only when the test calls `screen.ask`;
  ordinary tests must not require credentials or contact the network.

Checks:

- valid AI config resolves;
- unknown AI keys, empty model, credentials, and invalid timeout fail validation;
- existing configs without `ai` remain unchanged.

### 3. Schema-driven analyzer

Files:

- new `packages/runner/src/screenQuestion.ts`
- new `packages/runner/src/screenQuestion.test.ts`

Changes:

- Add one `answerScreenQuestion` function around `generateText`.
- Accept image bytes, media type, question, AI SDK output specification, language
  model, timeout, and abort signal.
- Return the validated output, response model id, and usage.
- Sanitize provider/auth/network/timeout/unsupported-image and invalid-output
  errors without retaining request or response bodies. The runner's existing
  infrastructure-failure classification is sufficient.

Checks:

- `Output.choice` returns the literal union;
- `Output.object` returns its declared object type;
- PNG and JPEG message parts use the correct media type;
- abort propagates;
- invalid structured output and provider failures remain infrastructure errors.

### 4. `tv.screen.ask`

Files:

- `packages/runner/src/defineTvTest.ts`
- `packages/runner/src/testContext.ts`
- `packages/runner/src/runner.ts`
- `packages/runner/src/runner.test.ts` or a focused new test-context test

Changes:

- Add the generic `ask(options)` method beside `screen.capture`.
- Reuse `captureName`, `resolveContained`, the runner-selected PNG/JPEG format,
  and the existing `execute({ kind: "screen.capture" })` path.
- Generate a contained `screen-question-N` artifact name for each call.
- Fail before capture when neither injection nor config supplies a model.
- Return `{ output, modelId, usage }`; do not create a synthetic device operation
  or assertion record.
- Document that test authors must declare `"screen.capture"` in `requires`.

Checks:

- one ask creates exactly one capture operation;
- the existing screenshot artifact remains attached to that operation;
- missing model, provider error, and invalid schema output produce exit 2;
- an assertion against an unexpected valid answer produces exit 1 through the
  existing assertion machinery;
- cancellation remains exit 130/143;
- Android PNG and webOS JPEG both reach the analyzer.

### 5. Examples and evaluation

Files:

- one focused example under `examples/`
- `README.md` only if it already documents TV test authoring

Add examples for:

- a finite screen-state choice;
- an object containing `page`, `menuOpen`, `posterFocused`, and `visibleButtons`.

Before calling the feature stable, run a small fixed set of representative TV
screenshots and questions three times for each supported model route. Record
accuracy, unknown/uncertain rate, flake rate, latency, and cost. Pixel comparison
remains preferred when an exact baseline is suitable.

## Commit sequence

1. `feat(runner): add schema-driven screen analyzer`. Add the dependency,
   installed-API verification, analyzer, and mock-backed checks.
2. `feat(runner): expose tv.screen.ask`. Add configuration, model injection,
   test context integration, and runner checks.
3. `docs(runner): add screen question examples`.

Each commit must build and test independently. If the spike is purely
exploratory, discard its temporary network test before the first commit and keep
only a deterministic mock-backed check.

## Verification

```bash
bun test packages/runner/src/config.test.ts
bun test packages/runner/src/screenQuestion.test.ts
bun test packages/runner/src/runner.test.ts
bun run --filter @couch/runner build
bun run typecheck
bun test
```

Run the live provider smoke test separately and only when an API key is
explicitly available. It must not be part of the default test suite.

## Acceptance criteria

- A test can pass `Output.choice` and receive its inferred literal union.
- A test can pass `Output.object` and receive its inferred object type.
- A test can use `Output.object({ schema: jsonSchema<T>(...) })` without a cast.
- Changing the configured Gateway model does not change test code.
- Passing a direct provider model through `RunTvTestOptions` does not change the
  analyzer or test API.
- Ordinary non-AI tests work without AI configuration or credentials.
- AI requests are explicit, cancellable, bounded, and never contain secrets from
  config.
- Existing visual baselines and ODiff behavior are untouched.

## Add later only when needed

- `couch ask` for interactive use;
- named model aliases or `createProviderRegistry`;
- persistent usage/latency records in `TestResult`;
- stable-frame polling before AI analysis;
- provider fallback, retry policy, caching, or consensus calls.
