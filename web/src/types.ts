export type StateKind = 'root' | 'branch';
export type StateStatus = 'active' | 'abandoned' | 'merged';
export type Role = 'user' | 'assistant' | 'system';
export type MessageStatus = 'streaming' | 'complete' | 'failed';

export interface Project {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StateRow {
  id: string;
  projectId: string;
  parentId: string | null;
  branchPointMessageId: string | null;
  branchPointSeq: number | null;
  title: string;
  kind: StateKind;
  status: StateStatus;
  depth: number;
  summary: string | null;
}

export interface TreeNode {
  id: string;
  parentId: string | null;
  title: string;
  kind: StateKind;
  status: StateStatus;
  depth: number;
  branchPointSeq: number | null;
  messageCount: number;
  createdAt: string;
  children: TreeNode[];
}

export interface Message {
  id: string;
  stateId: string;
  seq: number;
  role: Role;
  content: string;
  status: MessageStatus;
  model: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: string | null;
  createdAt: string;
}

export interface ContextPreview {
  stateId: string;
  chain: Array<{
    stateId: string;
    title: string;
    kind: StateKind;
    status: StateStatus;
    upDepth: number;
    cutoffSeq: number | null;
    role: 'focus' | 'memory';
    visibleMessages: number;
    summary: string | null;
    summaryStale: boolean;
  }>;
  messages: Array<{
    id: string;
    stateId: string;
    stateTitle: string;
    upDepth: number;
    seq: number;
    role: Role;
    content: string;
  }>;
  totals: { states: number; messages: number; characters: number };
  budget: { note: string; limitTokens: number };
}

export type ChatEvent =
  | {
      type: 'start';
      userMessageId: string;
      assistantMessageId: string;
      model: string;
      visibleMessages: number;
      sentMessages: number;
    }
  | { type: 'delta'; text: string }
  | {
      type: 'done';
      assistantMessageId: string;
      tokensIn: number | null;
      tokensOut: number | null;
      costUsd: string | null;
      latencyMs: number;
    }
  | { type: 'error'; code: string; message: string; status?: number };
