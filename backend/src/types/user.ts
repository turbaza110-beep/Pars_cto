export type UserStatus = "active" | "inactive" | "blocked";

export interface UserProfile {
  role?: string;
  workspace?: string;
  displayName?: string;
  avatarUrl?: string;
  [key: string]: unknown;
}

export interface User {
  id: string;
  email?: string;
  phoneNumber?: string;
  telegramId?: string;
  telegramUsername?: string;
  fullName?: string;
  role?: string;
  status?: UserStatus;
  permissions?: string[];
  profile?: UserProfile;
}

export interface JwtPayload {
  sub: string;
  email?: string;
  role?: string;
  permissions?: string[];
  profile?: UserProfile;
  sessionId?: string;
  telegramId?: string;
  exp?: number;
  iat?: number;
}
