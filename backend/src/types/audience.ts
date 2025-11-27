import { ActivityLevel } from "@/types/parsing";

export type SegmentStatus = "processing" | "ready" | "failed";

export type AudiencePostFrequency = "daily" | "weekly" | "monthly";

export interface AudienceSegmentFilters {
  engagement_min?: number;
  engagement_max?: number;
  post_frequency?: AudiencePostFrequency;
  language?: string;
  min_subscribers?: number;
}

export interface NormalizedAudienceSegmentFilters {
  engagementMin?: number;
  engagementMax?: number;
  postFrequency?: AudiencePostFrequency;
  language?: string;
  minSubscribers?: number;
}

export interface AudienceSegment {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  sourceParsingId: string | null;
  filters: NormalizedAudienceSegmentFilters | null;
  status: SegmentStatus;
  totalRecipients: number;
  createdAt: string;
  updatedAt: string;
}

export interface AudiencePreviewEntry {
  username: string | null;
  userId: string | number;
  engagementScore: number;
  activityLevel: ActivityLevel;
}
