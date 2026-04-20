import React from "react";
import { Box, Text } from "ink";
import type { ApprovalMode, TranscriptEvent } from "@kimicode/core";

export interface AppProps {
  sessionId: string;
  modelId: string;
  thinkingEnabled: boolean;
  approvalMode: ApprovalMode;
  output: string;
  events: TranscriptEvent[];
  status: string;
  error?: string;
}

const summarizeEvent = (event: TranscriptEvent): string => {
  switch (event.type) {
    case "tool.call":
      return `tool call: ${String(event.data.toolName)}`;
    case "tool.result":
      return `tool result: ${String(event.data.message ? "written" : "received")}`;
    case "warning":
      return `warning: ${String(event.data.message)}`;
    case "approval.requested":
      return `approval requested: ${String(event.data.toolName)}`;
    case "approval.resolved":
      return `approval resolved: ${String(event.data.toolName)}`;
    default:
      return event.type;
  }
};

export function App(props: AppProps): React.ReactElement {
  return (
    <Box flexDirection="column" padding={1}>
      <Text color="cyanBright">Kimicode</Text>
      <Text dimColor>
        session {props.sessionId} | model {props.modelId} | thinking {props.thinkingEnabled ? "on" : "off"} | approvals{" "}
        {props.approvalMode}
      </Text>
      <Box marginTop={1} flexDirection="column">
        <Text color="green">Assistant</Text>
        <Text>{props.output || "Waiting for model output..."}</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text color="yellow">Timeline</Text>
        {props.events.length === 0 ? <Text dimColor>No tool activity yet.</Text> : props.events.slice(-8).map((event) => <Text key={event.id}>• {summarizeEvent(event)}</Text>)}
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>Status: {props.status}</Text>
        {props.error ? <Text color="red">Error: {props.error}</Text> : null}
      </Box>
    </Box>
  );
}
