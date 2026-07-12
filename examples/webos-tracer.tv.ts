import { defineTvTest, Output } from "@couch/runner";

export default defineTvTest({
  name: "webOS menu smoke",
  requires: ["app.launch", "app.foreground", "control.press", "screen.capture"],

  async run({ tv, expect }) {
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
        { attempts: 3, intervalMs: 5000 },
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

    await tv.press("DOWN");
    await expect
      .poll(async () => {
        const result = await tv.screen.ask({
          question: "Is Genres focused in the sidebar?",
          output: Output.choice({ options: ["focused", "not-focused", "uncertain"] as const }),
        });
        return result.output;
      })
      .equal("focused");
    await tv.press("RIGHT");
    await expect
      .poll(async () => {
        const result = await tv.screen.ask({
          question: "Is the Genres submenu open with a genre focused?",
          output: Output.choice({ options: ["open", "closed", "uncertain"] as const }),
        });
        return result.output;
      })
      .equal("open");

    await tv.press("RIGHT");
    await expect
      .poll(async () => {
        const result = await tv.screen.ask({
          question: "Is the sidebar menu closed with focus back in the home content?",
          output: Output.choice({ options: ["focused", "not-focused", "uncertain"] as const }),
        });
        return result.output;
      })
      .equal("focused");
  },
});
