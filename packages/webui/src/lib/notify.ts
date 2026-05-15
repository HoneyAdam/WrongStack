/**
 * Browser Notification API wrapper. We never pop a notification when the
 * tab is foreground — the user already sees the chat update, so an OS
 * popup would just be noise. The flow:
 *
 *   1. requestPermission() is called lazily on first run completion;
 *      browsers require a user gesture for the prompt to be safe but
 *      Chrome / Firefox accept it from any code path with relaxed rules.
 *   2. notifyIfHidden() short-circuits unless the page is `document.hidden`.
 *   3. Clicking the notification focuses the page (best-effort — some
 *      browsers won't focus across tab groups).
 */

let permissionState: NotificationPermission | 'unsupported' = 'default';

if (typeof window !== 'undefined' && 'Notification' in window) {
  permissionState = Notification.permission;
} else {
  permissionState = 'unsupported';
}

export async function ensureNotificationPermission(): Promise<
  NotificationPermission | 'unsupported'
> {
  if (
    permissionState === 'unsupported' ||
    permissionState === 'granted' ||
    permissionState === 'denied'
  ) {
    return permissionState;
  }
  try {
    const result = await Notification.requestPermission();
    permissionState = result;
    return result;
  } catch {
    return 'denied';
  }
}

export function notifyIfHidden(title: string, body?: string): void {
  if (typeof document === 'undefined' || !document.hidden) return;
  if (permissionState !== 'granted') return;
  try {
    const n = new Notification(title, {
      body,
      icon: '/favicon.ico',
      // Tag-collapse: if multiple notifications stack while the tab is
      // hidden, only the latest "WrongStack run" shows up so we don't
      // litter the OS notification center.
      tag: 'wrongstack-run',
      // Auto-dismiss as soon as the user focuses the tab.
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    // Some browsers (e.g. iOS Safari) throw — silently swallow.
  }
}
