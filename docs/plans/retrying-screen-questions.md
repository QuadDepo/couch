# Polling assertions

Status: proposed

Plan date: 2026-07-12

## Goal

Replace fixed sleeps in TV tests with a runner-owned assertion loop that polls
an observed value until it matches or exhausts its attempts.

```ts
await tv.press("LEFT");

await expect
  .poll(
    async () =>
      (
        await tv.screen.ask({
          question: "Is the sidebar menu open with Home focused?",
          output: Output.choice({
            options: ["open", "closed", "uncertain"] as const,
          }),
        })
      ).output,
    { attempts: 3, intervalMs: 1_000 },
  )
  .equal("open");
```

The key press remains a one-shot action. `expect.poll` retries only its value
producer, so the callback must observe state and must not send input.

## Proposed interface

Add one assertion method beside `expect.equal`:

```ts
expect.poll(
  actual: () => T | Promise<T>,
  options?: { attempts?: number; intervalMs?: number },
).equal(expected: T, message?: string): Promise<void>
```

- `equal` uses the value type inferred from the polling callback.
- `attempts` defaults to 3 and includes the first observation.
- `intervalMs` defaults to 1,000.
- The first observation happens immediately. There is no initial sleep.
- A mismatch is retried after `intervalMs`.
- A match records one passed `poll.equal` assertion and returns.
- Exhausting `attempts` records one failed assertion with the final observed
  value and throws `AssertionFailure`.
- Cancellation aborts the current observation and polling delay through the
  runner signal.

Keep one matcher, `equal`, for now. Add more polling matchers only when a real
test needs them. Do not add a generic retrying assertion callback. It would be
easy to place `tv.press()` inside it and repeat a side effect.

## WebOS tracer shape

The example becomes a sequence of one-shot actions followed by observable
state checks:

```ts
await tv.app.launch();
expect.foreground(await tv.app.foreground());

await expect
  .poll(
    async () =>
      (
        await tv.screen.ask({
          question:
            "Is the Pathé Thuis splash screen visible, or is the home screen ready with Buy Now focused?",
          output: Output.choice({
            options: ["splash-visible", "home-ready", "unexpected"] as const,
          }),
        })
      ).output,
    { attempts: 3, intervalMs: 5_000 },
  )
  .equal("home-ready", "Splash screen remained after 3 observations");

await tv.press("LEFT");
await expect
  .poll(async () => {
    const result = await tv.screen.ask({
      question: "Is the sidebar menu open with Home focused?",
      output: Output.choice({ options: ["open", "closed", "uncertain"] as const }),
    });
    return result.output;
  })
  .equal("open");
```

Before sending `RIGHT` after `DOWN`, add a screen check for the focus state that
makes `RIGHT` valid. This removes the last timing assumption between different
keys. Repeated identical keys can continue using `tv.press(key, { times,
intervalMs })` because that interval is an intentional input cadence, not a
claim that the screen is ready.

## Key timing

Treat key timing and screen readiness separately:

- Use `tv.press(key, { times, intervalMs })` when sending a burst of the same
  key. The interval is a hardware input cadence and remains explicit at the
  call site.
- After a key that triggers navigation or animation, poll the resulting state
  before sending a key that depends on it.
- Remove standalone sleeps when either mechanism covers the wait.

Do not add a global key delay in this change. A global value would slow every
device and app while still making no guarantee about screen readiness. If live
runs show that one target drops all closely spaced key writes regardless of app
state, add a target-level minimum key interval later and enforce it inside
`tv.press`. Keep the per-call option as the calibration override.

Do not add a mixed-key sequence method yet. The current `DOWN` then `RIGHT`
case is state-dependent and must retain an assertion between the actions.

## Implementation plan

1. In `packages/runner/src/defineTvTest.ts`, add the generic `expect.poll`
   interface with the single `equal` matcher. Do not change `tv.screen.ask` or
   add device-layer methods.
2. In `packages/runner/src/testContext.ts`, reuse the existing abortable `wait`
   helper. Poll the value producer until strict equality or attempts run out.
   Validate positive integer attempts and interval values. Record one assertion
   for the whole poll, not one per attempt. The existing AI request timeout
   continues to bound each `screen.ask` call.
3. Add focused runner tests covering immediate success, retry then success,
   exhausted attempts as an assertion failure, and abort during the polling
   delay. Use the existing mock language model and fake capture operations.
4. Replace the sleeps and startup loop in `examples/webos-tracer.tv.ts` with
   `expect.poll(...).equal(...)`. Add the missing observable checkpoint between
   `DOWN` and `RIGHT`.
5. Run `bun test packages/runner` and `bun run typecheck`. Then run the WebOS
   tracer against the living-room target to tune only the two explicit timing
   values if the real TV needs it.

## Cypress findings

Cypress reaches the same split: actions execute once, while queries and
assertions retry. Playwright exposes this directly as `expect.poll`. A
remote-key send must never live inside Cypress `.should()`, because Cypress can
rerun that callback and send the key more than once. Invoke an SDK promise once
through `.then()`, then use a fresh query and `.should()` for the observable
transition.

Useful official references:

- [Playwright `expect.poll`](https://playwright.dev/docs/test-assertions#expectpoll)
- [Retry-ability](https://docs.cypress.io/app/core-concepts/retry-ability)
- [`.should()`](https://docs.cypress.io/api/commands/should)
- [`.then()`](https://docs.cypress.io/api/commands/then)
- [Best practices for avoiding arbitrary waits](https://docs.cypress.io/app/core-concepts/best-practices)
- [`cy.wrap()` and promises](https://docs.cypress.io/api/commands/wrap)

Cypress can verify browser-visible DOM, URL, and network state. The Couch runner
must still guarantee key ordering, await each transport operation, expose
failures, and avoid retrying side effects. No Cypress dependency or integration
belongs in this change.

## Out of scope

- retrying key presses or reconnecting the TV;
- adding a global key delay or mixed-key sequence method;
- changing device connection flows or state machines;
- adding a general retry utility or assertion library;
- confidence scoring, model voting, or cached AI answers;
- moving timing defaults into `couch.config.ts` before more than one test needs
  shared values.
