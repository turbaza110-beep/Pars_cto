export interface BroadcastJob {
  broadcastId: string;
  audience: string[];
  payload: string;
  priority?: "low" | "normal" | "high";
  attachments?: string[];
}
