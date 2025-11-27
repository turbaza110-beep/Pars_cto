import type { AuthUser } from "@/types/auth";

export function buildTelegramPhotoUrl(photoId?: string | null) {
  if (!photoId) {
    return null;
  }

  return `https://t.me/i/userpic/320/${photoId}.jpg`;
}

export function getUserAvatarUrl(user?: AuthUser | null) {
  const telegramPhoto = buildTelegramPhotoUrl(user?.telegram_profile_photo_id);
  if (telegramPhoto) {
    return telegramPhoto;
  }

  const seed = encodeURIComponent(user?.telegram_username ?? user?.id ?? "LoveParser");
  return `https://api.dicebear.com/7.x/initials/svg?seed=${seed}`;
}

export function getUserBackgroundImage(user?: AuthUser | null) {
  return buildTelegramPhotoUrl(user?.telegram_profile_photo_id) ?? undefined;
}
