import { type KeyEvent, TextAttributes } from "@opentui/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { DIM_COLOR, FOCUS_COLOR, TEXT_DIM } from "../../constants/colors.ts";
import { useDevice } from "../../hooks/useDevice.ts";
import { type PromptContext, useDialogKeyboard } from "../../vendor/dialog/react";
import { KeyHint } from "../shared/KeyHint.tsx";
import { InputBuffer } from "./InputBuffer.tsx";
import { QUICK_ACTIONS, type QuickActionRow, QuickActions } from "./QuickActions.tsx";
import { UnsupportedMessage } from "./UnsupportedMessage.tsx";

type TextInputModalProps = PromptContext<unknown>;

const ACTION_HIGHLIGHT_DELAY = 200;
const SEND_DEBOUNCE_MS = 100;

export function TextInputModal({ dismiss, dialogId }: TextInputModalProps) {
  const { status, sendText, capabilities } = useDevice();

  const enabled = status === "connected";
  const textInputSupported = capabilities?.textInputSupported ?? false;
  const quickActions = capabilities?.textQuickActions ?? [];

  const [input, setInput] = useState("");
  const [internalFocus, setInternalFocus] = useState<"input" | "actions">("input");
  const [lastAction, setLastAction] = useState<string | null>(null);

  const actionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSendTimeRef = useRef<number>(0);

  const sendToTV = useCallback(
    (text: string) => {
      if (!enabled) return;

      const now = Date.now();
      if (now - lastSendTimeRef.current < SEND_DEBOUNCE_MS) {
        return;
      }
      lastSendTimeRef.current = now;

      sendText(text);
    },
    [enabled, sendText],
  );

  const triggerAction = useCallback(
    (row: QuickActionRow) => {
      if (actionTimeoutRef.current) {
        clearTimeout(actionTimeoutRef.current);
      }
      setLastAction(row.action);
      sendText(row.char);
      actionTimeoutRef.current = setTimeout(() => {
        setLastAction(null);
      }, ACTION_HIGHLIGHT_DELAY);
    },
    [sendText],
  );

  const handleInputKey = useCallback(
    (event: KeyEvent) => {
      switch (event.name) {
        case "return":
          event.preventDefault();
          if (input.trim()) {
            sendToTV(input);
            setInput("");
          }
          break;
        case "backspace":
          event.preventDefault();
          setInput((prev) => prev.slice(0, -1));
          break;
        case "space":
          event.preventDefault();
          setInput((prev) => `${prev} `);
          break;
        default:
          if (event.name.length === 1 && !event.ctrl && !event.meta) {
            const char = event.shift ? event.name.toUpperCase() : event.name;
            setInput((prev) => prev + char);
          }
      }
    },
    [input, sendToTV],
  );

  const handleActionsKey = useCallback(
    (event: KeyEvent) => {
      const row = QUICK_ACTIONS.find(
        (row) => row.keyName === event.name && quickActions.includes(row.action),
      );
      if (row) {
        event.preventDefault();
        triggerAction(row);
      }
    },
    [quickActions, triggerAction],
  );

  useDialogKeyboard((event) => {
    if (!enabled) return;

    if (event.name === "escape") {
      event.preventDefault();
      dismiss();
      return;
    }

    if (event.name === "tab") {
      event.preventDefault();
      setInternalFocus((prev) => (prev === "input" ? "actions" : "input"));
      return;
    }

    if (internalFocus === "input") {
      handleInputKey(event);
    } else {
      handleActionsKey(event);
    }
  }, dialogId);

  useEffect(() => {
    return () => {
      if (actionTimeoutRef.current) {
        clearTimeout(actionTimeoutRef.current);
      }
    };
  }, []);

  const inputFocused = internalFocus === "input";
  const actionsFocused = internalFocus === "actions";

  return (
    <box flexDirection="column" gap={1}>
      <box
        width="100%"
        height={3}
        borderStyle="single"
        borderColor={DIM_COLOR}
        flexDirection="row"
        justifyContent="space-between"
        alignItems="center"
        paddingLeft={1}
        paddingRight={1}
      >
        <box flexDirection="row">
          <text fg={FOCUS_COLOR} attributes={TextAttributes.BOLD}>
            Text input
          </text>
        </box>
        <box flexDirection="row">
          <KeyHint keyName="Tab" label="Switch" />
          <text fg={TEXT_DIM}> | </text>
          <KeyHint keyName="Esc" label="Close" />
        </box>
      </box>

      <box>
        {!textInputSupported ? (
          <UnsupportedMessage />
        ) : (
          <box flexDirection="column" gap={1}>
            <InputBuffer input={input} focused={inputFocused} enabled={enabled} />

            {quickActions.length > 0 && (
              <QuickActions
                focused={actionsFocused}
                lastAction={lastAction}
                actions={quickActions}
              />
            )}
          </box>
        )}
      </box>
    </box>
  );
}
