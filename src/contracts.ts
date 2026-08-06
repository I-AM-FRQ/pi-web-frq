export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export type ModelDescriptor = {
  provider: string;
  id: string;
  name: string;
  thinkingLevels: ThinkingLevel[];
};

export type ProviderConfigSummary = {
  id: string;
  name: string;
  baseUrl: string;
  api: string;
  authHeader: boolean;
  hasApiKey: boolean;
  models: Array<{
    id: string;
    name: string;
    reasoning: boolean;
    acceptsImages: boolean;
    contextWindow: number;
    maxTokens: number;
  }>;
};

export type ProviderConfigInput = Omit<ProviderConfigSummary, "hasApiKey"> & { apiKey?: string };

export type ChatImage = {
  type: "image";
  data: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
};

export type AgentResourceKind = "skills" | "plugins";

export type AgentResource = {
  id: string;
  kind: AgentResourceKind;
  name: string;
  description: string;
  enabled: boolean;
  content: string;
  origin: "managed" | "default" | "configured";
  editable: boolean;
};

export type AgentResources = {
  skills: AgentResource[];
  plugins: AgentResource[];
  directories: { skills: string[]; plugins: string[] };
};

export type Project = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type ChatRequest = {
  prompt: string;
  images?: ChatImage[];
  sessionId?: string;
  branchFromEntryId?: string;
  model?: { provider: string; id: string };
  thinkingLevel?: ThinkingLevel;
  resources?: { skills: string[]; plugins: string[] };
  projectId?: string;
  autoRetry?: boolean;
};

export type SessionSummary = {
  id: string;
  name?: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  firstMessage: string;
  completed?: boolean;
};

export type ConversationItem =
  | { type: "user"; content: string; timestamp: string; id?: string }
  | { type: "thinking"; content: string; timestamp: string }
  | { type: "tool"; id: string; name: string; label: string; result?: string; isError: boolean; timestamp: string }
  | { type: "assistant"; content: string; timestamp: string; isError: boolean; model?: { provider: string; id: string } }; 

export type SessionTreeNode = {
  id: string;
  kind: "user" | "assistant" | "tool" | "summary" | "setting" | "metadata";
  label: string;
  timestamp: string;
  children: SessionTreeNode[];
};

export type SessionContextSummary = {
  scope: "active" | "preview";
  entryCount: number;
  messageCount: { user: number; assistant: number; tool: number; other: number };
  tokens: number;
  contextWindow: number | null;
  percent: number | null;
  model: { provider: string; id: string } | null;
  thinkingLevel: string;
  compacted: boolean;
};

export type SessionUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  cost: number;
  usageRecords: number;
};

export type SessionDetail = {
  session: SessionSummary;
  activeLeafId: string | null;
  previewEntryId: string | null;
  conversation: ConversationItem[];
  tree: SessionTreeNode[];
  usage: SessionUsage;
  context: SessionContextSummary | null;
  conversationNextOffset: number | null;
  truncated: { conversation: boolean; tree: boolean };
  treeLoaded: boolean;
};

export type ApiErrorResponse = {
  error: { code: string; message: string };
};

export type LiveToolStep = { id: string; name: string; label: string; result?: string; isError: boolean; running: boolean };

/** 按真实执行顺序排列的实时时间线条目（思考/工具/文本交错出现）。 */
export type LiveTimelineItem =
  | { kind: "tool"; id: string; name: string; label: string; result?: string; isError: boolean; running: boolean }
  | { kind: "thinking"; text: string }
  | { kind: "text"; text: string };

export type ChatStreamEvent =
  | { type: "start"; runId: string; sessionId: string; prompt?: string; model?: { provider: string; id: string } }
  | { type: "tool_start"; id: string; name: string; label: string }
  | { type: "tool_end"; id: string; result: string; isError: boolean }
  | { type: "text_delta"; delta: string }
  | { type: "thinking_delta"; delta: string }
  | { type: "retry_scheduled"; attempt: number; maxAttempts: number; delayMs: number; message: string }
  | { type: "retry_finished"; success: boolean; attempt: number; message?: string }
  | { type: "queue_update"; steering: readonly string[]; followUp: readonly string[] }
  | { type: "done"; sessionId: string }
  | { type: "error"; code: string; message: string };
