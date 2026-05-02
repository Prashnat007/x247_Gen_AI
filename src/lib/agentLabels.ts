// Shared, single source of truth for friendly agent display names.
// Anywhere the UI shows a sub-agent (Coordinator / Recall / Tasks / etc.),
// it must go through `friendlyAgent` so we never leak raw "FooAgent"
// identifiers into the chat. Keys mirror the backend's TOOL_AGENT_MAP in
// app/coordinator.py — when you add a new sub-agent there, add its label
// here too.
export const AGENT_LABEL: Record<string, string> = {
  Orchestrator: 'Coordinator',
  CaptureAgent: 'Capture',
  RecallAgent: 'Recall',
  TaskAgent: 'Tasks',
  CalendarAgent: 'Calendar',
  BriefingAgent: 'Briefing',
  AnalyticsAgent: 'Insights',
  ClarifierAgent: 'Clarifier',
};

export const friendlyAgent = (a: string): string =>
  AGENT_LABEL[a] || a.replace('Agent', '');
