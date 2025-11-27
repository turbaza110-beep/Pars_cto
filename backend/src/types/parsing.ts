export type ActivityLevel = "low" | "medium" | "high";

export type ParsingStatus = "pending" | "processing" | "completed" | "failed";

export type ParsingProgressStatus =
  | "pending"
  | "initializing"
  | "scanning_channels"
  | "analyzing_data"
  | "completed"
  | "failed";

export interface ParsingFilters {
  language?: string;
  min_subscribers?: number;
  max_subscribers?: number;
  activity_level?: ActivityLevel;
}

export interface NormalizedParsingFilters {
  language?: string;
  minSubscribers?: number;
  maxSubscribers?: number;
  activityLevel?: ActivityLevel;
}

export type SearchMode = "simulation" | "live";

export interface ParsedChannel {
  channelId: string;
  title?: string | null;
  username?: string | null;
  subscribers: number;
  description?: string | null;
  language?: string | null;
  activityScore: number;
  activityLevel: ActivityLevel;
  lastPost?: string | null;
}

export interface ParsingHistoryEntry {
  id: string;
  query: string;
  status: ParsingStatus;
  resultCount: number;
  createdAt: string;
  filters?: NormalizedParsingFilters;
}

export interface ParsingProgressSnapshot {
  searchId?: string;
  progress: number;
  status: ParsingProgressStatus;
  current?: number;
  total?: number;
  results?: number;
  error?: string;
  updated_at: string;
}
