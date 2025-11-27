import { AudienceSegmentJob } from "@/jobs/audienceJob";
import { BroadcastJob } from "@/jobs/broadcastJob";
import { CleanupDataJob } from "@/jobs/cleanupDataJob";
import { NotificationJob } from "@/jobs/notificationJob";
import { ParseSearchJob } from "@/jobs/parseSearchJob";

export enum JobTypes {
  PARSE_SEARCH = "parse-search",
  BROADCAST = "broadcast",
  NOTIFICATION = "notification",
  CLEANUP_DATA = "cleanup-data",
  AUDIENCE_SEGMENT = "audience-segment",
}

export type JobPayloadMap = {
  [JobTypes.PARSE_SEARCH]: ParseSearchJob;
  [JobTypes.BROADCAST]: BroadcastJob;
  [JobTypes.NOTIFICATION]: NotificationJob;
  [JobTypes.CLEANUP_DATA]: CleanupDataJob;
  [JobTypes.AUDIENCE_SEGMENT]: AudienceSegmentJob;
};

export type JobPayload<T extends JobTypes> = JobPayloadMap[T];
