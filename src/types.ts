export interface UserProfile {
  userId: string;
  email: string;
  displayName?: string;
  photoURL?: string;
  createdAt: string;
}

export interface Workspace {
  workspaceId: string;
  name: string;
  ownerId: string;
  members: string[]; // User UIDs
  createdAt: string;
}

export interface Document {
  documentId: string;
  workspaceId: string;
  name: string;
  sourceType: "PDF" | "DOCX" | "TXT" | "Markdown" | "CSV" | "Image" | "URL" | "YouTube";
  sourceUrl?: string;
  status: "processing" | "completed" | "failed";
  progressMsg?: string;
  characterCount?: number;
  uploadedBy: string;
  createdAt: string;
}

export interface DocumentChunk {
  chunkId: string;
  documentId: string;
  workspaceId: string;
  text: string;
  embedding: number[];
  index: number;
  metadata: {
    fileName: string;
    sourceType: string;
    length: number;
    error?: string;
  };
}

export interface Conversation {
  conversationId: string;
  workspaceId: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface Citation {
  chunkId: string;
  fileName: string;
  sourceType: string;
  snippet: string;
  index: number;
}

export interface ChatMessage {
  messageId: string;
  conversationId: string;
  sender: "user" | "ai";
  text: string;
  citations?: Citation[];
  createdAt: string;
}
