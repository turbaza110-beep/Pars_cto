export interface SubscriptionInfo {
  plan_type: string | null;
  status: string | null;
  expires_at: string | null;
}

export interface UsageLimits {
  [key: string]: number | string | null;
}

export interface AuthUser {
  id: string;
  phone_number: string | null;
  telegram_id: string | null;
  telegram_username: string | null;
  telegram_profile_photo_id: string | null;
  first_name: string | null;
  last_name: string | null;
  subscription: SubscriptionInfo | null;
  limits: UsageLimits;
  is_active: boolean;
}
