import { defineTvTest, Output } from "@couch/runner";

export default defineTvTest({
  name: "webOS three-down AI smoke",
  requires: ["app.launch", "app.foreground", "control.press", "screen.capture"],

  async run({ tv, expect }) {
    await tv.app.launch();
    expect.foreground(await tv.app.foreground());

    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    await sleep(5000);

    await tv.press("DOWN", {
      times: 3,
      intervalMs: 300,
    });

    await sleep(1000);

    console.log("Asking AI whether The Devil Wears Prada 2 has focus...");

    const focus = await tv.screen.ask({
      question: "Does The Devil Wears Prada 2 have focus?",
      output: Output.choice({
        options: ["focused", "not-focused", "uncertain"] as const,
      }),
    });
    console.log("AI response:", focus.output);
    expect.equal(focus.output, "focused");

    await tv.press("LEFT", {
      times: 1,
      intervalMs: 300,
    });

    await sleep(500);

    const focusAfterLeft = await tv.screen.ask({
      question: "Is the sidebar menu open?",
      output: Output.choice({
        options: ["open", "closed", "uncertain"] as const,
      }),
    });
    expect.equal(focusAfterLeft.output, "open");
  },
});
