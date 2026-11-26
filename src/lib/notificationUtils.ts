export type AppNotificationCategory =
  | 'training_completed'
  | 'training_failed'
  | 'model_deployed'
  | 'sync_completed'
  | 'desktop_paired'
  | 'desktop_revoked'
  | 'pwa_update';

export interface AppNotificationItem {
  id: string;
  category: AppNotificationCategory;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
}

export function sortAndCapNotifications(
  items: AppNotificationItem[],
  max = 40
): AppNotificationItem[] {
  return [...items]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, max);
}
