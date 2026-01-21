import { useState } from "react";
import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useDialogState } from "@opentui-ui/dialog/react";
import type { RemoteKey } from "../../types/index.ts";
import { Panel } from "../shared/Panel.tsx";

interface DPadProps {
  enabled: boolean;
  focused?: boolean;
  onCommand: (key: RemoteKey) => void;
}

const CELL_WIDTH = 8;
const CELL_HEIGHT = 3;
const GAP = 1;

const DIM_COLOR = "#444444";
const ACTIVE_COLOR = "#00FF00";

export function DPad({ enabled, focused = false, onCommand }: DPadProps) {
  const [lastKey, setLastKey] = useState<string>();
  const isDialogOpen = useDialogState((s) => s.isOpen);

  const bright = enabled ? "#FFFFFF" : DIM_COLOR;

  const c = (key: string) => (lastKey === key ? ACTIVE_COLOR : bright);
  const border = (key: string) => (lastKey === key ? ACTIVE_COLOR : DIM_COLOR);

  const sendCommand = (key: RemoteKey) => {
    if (!enabled) return;
    setLastKey(key);
    onCommand(key);
    setTimeout(() => setLastKey(undefined), 200);
  };

  useKeyboard((event) => {
    if (!focused || isDialogOpen) return;

    switch (event.name) {
      case "up":
        sendCommand("UP");
        break;
      case "down":
        sendCommand("DOWN");
        break;
      case "left":
        sendCommand("LEFT");
        break;
      case "right":
        sendCommand("RIGHT");
        break;
      case "return":
        sendCommand("OK");
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
      <box flexDirection="column">
        <box
          flexDirection="row"
          flexWrap="wrap"
          width={(CELL_WIDTH + GAP) * 3}
          rowGap={GAP}
          columnGap={GAP}
        >
          <box width={CELL_WIDTH} height={CELL_HEIGHT}>
            <text fg={DIM_COLOR}> </text>
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
    </Panel>
  );
}
