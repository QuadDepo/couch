import type { RemoteKey } from "@couch/device";
import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { ACTIVE_COLOR, DIM_COLOR, TEXT_PRIMARY } from "../../constants/colors.ts";
import { useDevice } from "../../hooks/useDevice.ts";
import { useDialog, useDialogState } from "../../vendor/dialog/react";
import { TextInputModal } from "../dialogs/TextInputModal.tsx";
import { KeyHint } from "../shared/KeyHint.tsx";
import { Panel } from "../shared/Panel.tsx";

interface DPadProps {
  focused?: boolean;
}

const CELL_WIDTH = 8;
const CELL_HEIGHT = 3;
const GAP = 1;
const HIGHLIGHT_RESET_MS = 200;

interface DPadCellProps {
  glyph: string;
  active: boolean;
  enabled: boolean;
  bold?: boolean;
}

const DPadCell = memo(function DPadCell({ glyph, active, enabled, bold }: DPadCellProps) {
  const bright = enabled ? TEXT_PRIMARY : DIM_COLOR;
  return (
    <box
      width={CELL_WIDTH}
      height={CELL_HEIGHT}
      borderStyle="single"
      borderColor={active ? ACTIVE_COLOR : DIM_COLOR}
      justifyContent="center"
      alignItems="center"
    >
      <text fg={active ? ACTIVE_COLOR : bright} attributes={bold ? TextAttributes.BOLD : undefined}>
        {glyph}
      </text>
    </box>
  );
});

function DPadSpacer() {
  return (
    <box width={CELL_WIDTH} height={CELL_HEIGHT}>
      <text fg={DIM_COLOR}> </text>
    </box>
  );
}

export function DPad({ focused = false }: DPadProps) {
  const { status, sendKey } = useDevice();

  const enabled = status === "connected";

  const [lastKey, setLastKey] = useState<string>();
  const dialog = useDialog();
  const isDialogOpen = useDialogState((s) => s.isOpen);

  const resetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCommand = useCallback(
    (key: RemoteKey) => {
      if (!enabled) return;
      setLastKey(key);
      sendKey(key);
      if (resetTimeoutRef.current) {
        clearTimeout(resetTimeoutRef.current);
      }
      resetTimeoutRef.current = setTimeout(() => setLastKey(undefined), HIGHLIGHT_RESET_MS);
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

  useEffect(() => {
    return () => {
      if (resetTimeoutRef.current) {
        clearTimeout(resetTimeoutRef.current);
      }
    };
  }, []);

  return (
    <Panel
      title="D-PAD"
      focused={focused}
      width="100%"
      height="100%"
      alignItems="center"
      justifyContent="center"
    >
      <box flexDirection="column" gap={1}>
        <box
          flexDirection="row"
          flexWrap="wrap"
          width={(CELL_WIDTH + GAP) * 3}
          rowGap={GAP}
          columnGap={GAP}
        >
          <DPadCell glyph="←" active={lastKey === "BACK"} enabled={enabled} />
          <DPadCell glyph="▲" active={lastKey === "UP"} enabled={enabled} />

          <DPadSpacer />
          <DPadCell glyph="◀" active={lastKey === "LEFT"} enabled={enabled} />
          <DPadCell glyph="OK" active={lastKey === "OK"} enabled={enabled} bold />
          <DPadCell glyph="▶" active={lastKey === "RIGHT"} enabled={enabled} />

          <DPadSpacer />
          <DPadCell glyph="▼" active={lastKey === "DOWN"} enabled={enabled} />
          <DPadSpacer />
        </box>
      </box>
      <box width="100%" justifyContent="flex-end" marginTop="auto" paddingLeft={2} paddingRight={2}>
        <KeyHint keyName="I" label="Text Input" highlight={focused} />
      </box>
    </Panel>
  );
}
