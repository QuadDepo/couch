import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import type { PromptContext } from "@opentui-ui/dialog/react";
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
import { useUIStore } from "../../store/uiStore";
import { KeyHint } from "../shared/KeyHint.tsx";

type TextInputModalProps = PromptContext<unknown>;

const STATUS_CLEAR_DELAY = 2000;
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
        {actions.includes("enter") && (
          <text
            fg={lastAction === "enter" ? ACTIVE_COLOR : focused ? TEXT_SECONDARY : DIM_COLOR}
            attributes={lastAction === "enter" ? TextAttributes.BOLD : undefined}
          >
            [Enter]
          </text>
        )}
        {actions.includes("space") && (
          <text
            fg={lastAction === "space" ? ACTIVE_COLOR : focused ? TEXT_SECONDARY : DIM_COLOR}
            attributes={lastAction === "space" ? TextAttributes.BOLD : undefined}
          >
            [Space]
          </text>
        )}
        {actions.includes("backspace") && (
          <text
            fg={lastAction === "del" ? ACTIVE_COLOR : focused ? TEXT_SECONDARY : DIM_COLOR}
            attributes={lastAction === "del" ? TextAttributes.BOLD : undefined}
          >
            [Bs]
          </text>
        )}
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
          {deviceType === "philips-android-tv"
            ? "Philips Android TV does not support text input via the JointSpace API"
            : "This device does not support text input"}
        </text>
      </box>
    </box>
  );
}

export function TextInputModal({ dismiss }: TextInputModalProps) {
  const { status, sendText, capabilities } = useDevice();

  const enabled = status === "connected";
  const textInputSupported = capabilities?.textInputSupported ?? false;
  const quickActions = capabilities?.textQuickActions ?? [];

  const focusPath = useUIStore((s) => s.focusPath);
  const setFocusPath = useUIStore((s) => s.setFocusPath);

  const [input, setInput] = useState("");
  const [_sendState, setSendState] = useState<{
    type: "idle" | "sending" | "success" | "error";
    message: string;
  }>({
    type: "idle",
    message: "",
  });
  const [internalFocus, setInternalFocus] = useState<"input" | "actions">("input");
  const [lastAction, setLastAction] = useState<string | null>(null);

  const statusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const actionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSendTimeRef = useRef<number>(0);

  const showStatus = useCallback((msg: string, type: "idle" | "sending" | "success" | "error") => {
    if (statusTimeoutRef.current) {
      clearTimeout(statusTimeoutRef.current);
    }
    setSendState({ type, message: msg });
    if (type !== "idle") {
      statusTimeoutRef.current = setTimeout(() => {
        setSendState({ type: "idle", message: "" });
      }, STATUS_CLEAR_DELAY);
    }
  }, []);

  const sendToTV = useCallback(
    async (text: string) => {
      if (!enabled) return;

      const now = Date.now();
      if (now - lastSendTimeRef.current < SEND_DEBOUNCE_MS) {
        return;
      }
      lastSendTimeRef.current = now;

      showStatus("Sending...", "sending");
      try {
        const result = await sendText(text);
        if (result.success) {
          showStatus(`Sent (${result.latencyMs}ms)`, "success");
        } else {
          showStatus(`Error: ${result.error}`, "error");
        }
      } catch {
        showStatus("Error: Failed to send", "error");
      }
    },
    [enabled, sendText, showStatus],
  );

  const triggerAction = useCallback(
    (actionId: string) => {
      if (actionTimeoutRef.current) {
        clearTimeout(actionTimeoutRef.current);
      }
      setLastAction(actionId);
      // Send special control characters that the device machine handles appropriately
      if (actionId === "enter") {
        sendText("\n"); // Enter/Return - triggers search/go
      } else if (actionId === "del") {
        sendText("\b"); // Backspace - delete one character
      } else if (actionId === "space") {
        sendText(" "); // Space - insert space character
      }
      actionTimeoutRef.current = setTimeout(() => {
        setLastAction(null);
      }, ACTION_HIGHLIGHT_DELAY);
    },
    [sendText],
  );

  useKeyboard((event) => {
    if (!enabled || focusPath !== "modal/text-input") return;

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
    } else {
      if (event.name === "return" && quickActions.includes("enter")) {
        event.preventDefault();
        triggerAction("enter");
      } else if (event.name === "space" && quickActions.includes("space")) {
        event.preventDefault();
        triggerAction("space");
      } else if (event.name === "backspace" && quickActions.includes("backspace")) {
        event.preventDefault();
        triggerAction("del");
      }
    }
  });

  useEffect(() => {
    setFocusPath("modal/text-input");
    return () => {
      setFocusPath("app/dpad");
      if (statusTimeoutRef.current) {
        clearTimeout(statusTimeoutRef.current);
      }
      if (actionTimeoutRef.current) {
        clearTimeout(actionTimeoutRef.current);
      }
    };
  }, [setFocusPath]);

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
