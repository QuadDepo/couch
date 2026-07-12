import { defineTvTest, Output } from "@couch/runner";

export default defineTvTest({
  name: "agent search",
  requires: ["app.launch", "app.foreground", "control.press", "control.text", "screen.capture"],
  async run({ tv, expect }) {
    await tv.app.launch();
    expect.foreground(await tv.app.foreground());
    await tv.agent.run('Go to Search and enter "Batman"', { maxSteps: 20 });

    const assertion = await tv.screen.ask({
      question: 'Is the Search screen visible with "Batman" entered?',
      output: Output.choice({ options: ["yes", "no", "unknown"] as const }),
    });
    expect.equal(assertion.output, "yes");
  },
});
