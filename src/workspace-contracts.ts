export type WorkspaceEntry = {
  name: string;
  path: string;
  kind: "file" | "directory";
};

export type WorkspaceCapabilities = {
  read: true;
  list: true;
  find: true;
  grep: true;
  write: boolean;
  edit: boolean;
};

export type WorkspaceResponse = {
  path: string;
  entries: WorkspaceEntry[];
  capabilities: WorkspaceCapabilities;
};

export type WorkspaceFilePreview = {
  path: string;
  content: string;
  totalLines: number;
  truncated: boolean;
  sizeBytes: number;
  modifiedAt: string;
};

export type WorkspaceFileMatch = {
  name: string;
  path: string;
};

export type WorkspaceFileSearchResponse = {
  query: string;
  matches: WorkspaceFileMatch[];
  truncated: boolean;
};

export type WorkspaceContentMatch = {
  path: string;
  line: number;
  text: string;
};

export type WorkspaceContentSearchResponse = {
  query: string;
  caseSensitive: boolean;
  regex: boolean;
  matches: WorkspaceContentMatch[];
  truncated: boolean;
};

export type WorkspaceGitStatusEntry = {
  path: string;
  indexStatus: string;
  worktreeStatus: string;
};

export type WorkspaceGitStatus = {
  available: boolean;
  branch?: string;
  entries: WorkspaceGitStatusEntry[];
  truncated: boolean;
};

export type WorkspaceGitDiffMode = "working" | "staged";

export type WorkspaceGitDiff = {
  path: string;
  mode: WorkspaceGitDiffMode;
  content: string;
  truncated: boolean;
};

export type WorkspaceGitAction =
  | { action: "stage"; paths: string[] }
  | { action: "unstage"; paths: string[] }
  | { action: "commit"; message: string }
  | { action: "switch"; branch: string };

export type WorkspaceGitCommit = {
  hash: string;
  message: string;
};

export type WorkspaceGitBranches = {
  current: string | null;
  branches: string[];
};
