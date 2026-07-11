import type { TextQuickAction } from "@couch/device";
import { type KeyEvent, TextAttributes } from "@opentui/core";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ACTIVE_COLOR,
  DIM_COLOR,
  ERROR_COLOR,
  FOCUS_COLOR,
  TEXT_DIM,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
} from "../../constants/colors.ts";
import { useDevice } from "../../hooks/useDevice.ts";
import { type PromptContext, useDialogKeyboard } from "../../vendor/dialog/react";
import { KeyHint } from "../shared/KeyHint.tsx";

type TextInputModalProps = PromptContext<unknown>;

const ACTION_HIGHLIGHT_DELAY = 200;
const SEND_DEBOUNCE_MS = 100;

function InputBuffer({
  input,
  focused,
  enabled,
}: {
  input: string;
  focused: boolean;
  enabled: boolean;
}) {
  const bright = enabled ? TEXT_PRIMARY : DIM_COLOR;
  return (
    <box
      borderStyle="single"
      borderColor={focused ? FOCUS_COLOR : DIM_COLOR}
      paddingLeft={1}
      paddingRight={1}
      justifyContent="center"
    >
      <box flexDirection="row" gap={1}>
        <text fg={focused ? FOCUS_COLOR : DIM_COLOR}>{focused ? "▶" : "▷"}</text>
        <text
          fg={focused ? FOCUS_COLOR : bright}
          attributes={focused ? TextAttributes.BOLD : undefined}
        >
          {input}
        </text>
        {focused && (
          <text fg={FOCUS_COLOR} attributes={TextAttributes.BOLD}>
            _
          </text>
        )}
      </box>
    </box>
  );
}

// `action` matches the device capability list (`textQuickActions`); `keyName`
// is the terminal key event name that triggers it (Enter arrives as "return").
const QUICK_ACTIONS = [
  { action: "enter", keyName: "return", label: "[Enter]", char: "\n" },
  { action: "space", keyName: "space", label: "[Space]", char: " " },
  { action: "backspace", keyName: "backspace", label: "[Bs]", char: "\b" },
] as const satisfies readonly {
  action: TextQuickAction;
  keyName: string;
  label: string;
  char: string;
}[];

type QuickActionRow = (typeof QUICK_ACTIONS)[number];

function QuickActions({
  focused,
  lastAction,
  actions,
}: {
  focused: boolean;
  lastAction: string | null;
  actions: readonly string[];
}) {
  return (
    <>
      <box>
        <text fg={focused ? FOCUS_COLOR : DIM_COLOR}>
          {focused ? "▶ QUICK ACTIONS" : "▷ QUICK ACTIONS"}
        </text>
      </box>
      <box flexDirection="row" gap={2}>
        {QUICK_ACTIONS.filter(({ action }) => actions.includes(action)).map(({ action, label }) => (
          <text
            key={action}
            fg={lastAction === action ? ACTIVE_COLOR : focused ? TEXT_SECONDARY : DIM_COLOR}
            attributes={lastAction === action ? TextAttributes.BOLD : undefined}
          >
            {label}
          </text>
        ))}
      </box>
    </>
  );
}

function UnsupportedMessage() {
  const { device } = useDevice();
  const deviceType = device?.platform ?? null;

  return (
    <box flexDirection="column" gap={1}>
      <box justifyContent="center">
        <text fg={ERROR_COLOR} attributes={TextAttributes.BOLD}>
          Text input is not supported on this device
        </text>
      </box>
      <box justifyContent="center">
        <text fg={DIM_COLOR}>
          {deviceType === "philips-tv"
            ? "Philips TV does not support text input via the JointSpace API"
            : "This device does not support text input"}
        </text>
      </box>
    </box>
  );
}

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
        (r) => r.keyName === event.name && quickActions.includes(r.action),
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
