import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useDialog, useDialogState } from "@opentui-ui/dialog/react";
import { useCallback, useState } from "react";
import { ACTIVE_COLOR, DIM_COLOR, TEXT_PRIMARY } from "../../constants/colors.ts";
import { useDevice } from "../../hooks/useDevice.ts";
import type { RemoteKey } from "../../types/index.ts";
import { TextInputModal } from "../dialogs/TextInputModal.tsx";
import { KeyHint } from "../shared/KeyHint.tsx";
import { Panel } from "../shared/Panel.tsx";

interface DPadProps {
  focused?: boolean;
}

const CELL_WIDTH = 8;
const CELL_HEIGHT = 3;
const GAP = 1;

export function DPad({ focused = false }: DPadProps) {
  const { status, sendKey } = useDevice();

  const enabled = status === "connected";

  const [lastKey, setLastKey] = useState<string>();
  const dialog = useDialog();
  const isDialogOpen = useDialogState((s) => s.isOpen);

  const bright = enabled ? TEXT_PRIMARY : DIM_COLOR;

  const c = (key: string) => (lastKey === key ? ACTIVE_COLOR : bright);
  const border = (key: string) => (lastKey === key ? ACTIVE_COLOR : DIM_COLOR);

  const handleCommand = useCallback(
    async (key: RemoteKey) => {
      if (!enabled) return;
      setLastKey(key);
      const result = await sendKey(key);
      if (!result.success) {
        console.error(`Failed to send ${key}: ${result.error}`);
      }
      setTimeout(() => setLastKey(undefined), 200);
    },
    [enabled, sendKey],
  );

  const handleOpenTextInput = useCallback(async () => {
    await dialog.prompt({
      content: (ctx) => <TextInputModal {...ctx} />,
      size: "large",
    });
  }, [dialog]);

  useKeyboard((event) => {
    if (!focused || isDialogOpen) return;

    switch (event.name) {
      case "up":
        handleCommand("UP");
        break;
      case "down":
        handleCommand("DOWN");
        break;
      case "left":
        handleCommand("LEFT");
        break;
      case "right":
        handleCommand("RIGHT");
        break;
      case "return":
        handleCommand("OK");
        break;
      case "backspace":
        handleCommand("BACK");
        break;
      case "i":
        event.preventDefault();
        handleOpenTextInput();
        break;
    }
  });

  return (
    <Panel
      title="D-PAD"
      focused={focused}
      width="100%"
      height="100%"
      alignItems="center"
      justifyContent="center"
    >
      <box width="100%" justifyContent="flex-end" marginTop="auto"></box>
      <box flexDirection="column" gap={1}>
        <box
          flexDirection="row"
          flexWrap="wrap"
          width={(CELL_WIDTH + GAP) * 3}
          rowGap={GAP}
          columnGap={GAP}
        >
          <box
            width={CELL_WIDTH}
            height={CELL_HEIGHT}
            borderStyle="single"
            borderColor={border("BACK")}
            justifyContent="center"
            alignItems="center"
          >
            <text fg={c("BACK")}>←</text>
          </box>
          <box
            width={CELL_WIDTH}
            height={CELL_HEIGHT}
            borderStyle="single"
            borderColor={border("UP")}
            justifyContent="center"
            alignItems="center"
          >
            <text fg={c("UP")}>▲</text>
          </box>

          <box width={CELL_WIDTH} height={CELL_HEIGHT}>
            <text fg={DIM_COLOR}> </text>
          </box>
          <box
            width={CELL_WIDTH}
            height={CELL_HEIGHT}
            borderStyle="single"
            borderColor={border("LEFT")}
            justifyContent="center"
            alignItems="center"
          >
            <text fg={c("LEFT")}>◀</text>
          </box>
          <box
            width={CELL_WIDTH}
            height={CELL_HEIGHT}
            borderStyle="single"
            borderColor={border("OK")}
            justifyContent="center"
            alignItems="center"
          >
            <text fg={c("OK")} attributes={TextAttributes.BOLD}>
              OK
            </text>
          </box>
          <box
            width={CELL_WIDTH}
            height={CELL_HEIGHT}
            borderStyle="single"
            borderColor={border("RIGHT")}
            justifyContent="center"
            alignItems="center"
          >
            <text fg={c("RIGHT")}>▶</text>
          </box>

          <box width={CELL_WIDTH} height={CELL_HEIGHT}>
            <text fg={DIM_COLOR}> </text>
          </box>
          <box
            width={CELL_WIDTH}
            height={CELL_HEIGHT}
            borderStyle="single"
            borderColor={border("DOWN")}
            justifyContent="center"
            alignItems="center"
          >
            <text fg={c("DOWN")}>▼</text>
          </box>
          <box width={CELL_WIDTH} height={CELL_HEIGHT}>
            <text fg={DIM_COLOR}> </text>
          </box>
        </box>
      </box>
      <box width="100%" justifyContent="flex-end" marginTop="auto" paddingLeft={2} paddingRight={2}>
        <KeyHint keyName="I" label="Text Input" highlight={focused} />
      </box>
    </Panel>
  );
}
