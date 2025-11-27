export interface SubscriptionSummary {
  plan_type: string | null;
  status: string | null;
  expires_at: string | null;
}

export interface AuthUserResponse {
  id: string;
  phone_number: string | null;
  telegram_id: string | null;
  telegram_username: string | null;
  telegram_profile_photo_id: string | null;
  first_name: string | null;
  last_name: string | null;
  subscription: SubscriptionSummary | null;
  limits: Record<string, number | string | null>;
  is_active: boolean;
}
