export interface BroadcastJob {
  campaignId: string;
  userId: string;
  recipients: string[];
  text: string;
  attachments?: string[];
  telegramSessionId?: string;
  priority?: "low" | "normal" | "high";
}
