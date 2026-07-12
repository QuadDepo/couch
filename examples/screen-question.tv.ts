import { defineTvTest, jsonSchema, Output } from "@couch/runner";

type ScreenDetails = {
  page: string;
  menuOpen: boolean;
  posterFocused: boolean;
  visibleButtons: string[];
};

export default defineTvTest({
  name: "screen question",
  requires: ["screen.capture"],
  async run({ tv, expect }) {
    const state = await tv.screen.ask({
      question: "Which screen is visible?",
      output: Output.choice({ options: ["home", "detail", "player", "unknown"] as const }),
    });
    expect.equal(state.output, "detail");

    const details = await tv.screen.ask({
      question: "Describe the visible page, menu, focused poster, and buttons.",
      output: Output.object({
        schema: jsonSchema<ScreenDetails>({
          type: "object",
          properties: {
            page: { type: "string" },
            menuOpen: { type: "boolean" },
            posterFocused: { type: "boolean" },
            visibleButtons: { type: "array", items: { type: "string" } },
          },
          required: ["page", "menuOpen", "posterFocused", "visibleButtons"],
          additionalProperties: false,
        }),
      }),
    });
    expect.equal(details.output.menuOpen, false);
  },
});
