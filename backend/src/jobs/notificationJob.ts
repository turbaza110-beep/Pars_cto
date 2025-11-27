export type NotificationChannel = "email" | "sms" | "push";

export interface NotificationJob {
  notificationId: string;
  recipientId: string;
  channel: NotificationChannel;
  template: string;
  payload: Record<string, unknown>;
  delayMs?: number;
}
