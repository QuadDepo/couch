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

    const focus = await tv.screen.ask({
      question: "Is a content poster, tile, or menu item visibly focused?",
      output: Output.choice({
        options: ["focused", "not-focused", "uncertain"] as const,
      }),
    });
    expect.equal(focus.output, "focused");
  },
});
