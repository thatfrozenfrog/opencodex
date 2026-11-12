export interface PlaygroundModel {
  id: string;
  provider: string;
  model: string;
  label: string;
  contextWindow?: number;
  custom?: boolean;
}

export interface GenerationSettings {
  systemPrompt: string;
  temperature: string;
  maxTokens: string;
  topP: string;
  reasoningEffort: string;
  stream: boolean;
}

export interface MessageMetadata {
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  finishReason?: string;
  request?: Record<string, unknown>;
  response?: Record<string, unknown>;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  model?: string;
  provider?: string;
  status: "pending" | "streaming" | "finished" | "failed" | "canceled";
  error?: string;
  metadata?: MessageMetadata;
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  settings: GenerationSettings;
  modelId: string;
  updatedAt: number;
}

export const DEFAULT_SETTINGS: GenerationSettings = {
  systemPrompt: "",
  temperature: "",
  maxTokens: "",
  topP: "",
  reasoningEffort: "",
  stream: false,
};
