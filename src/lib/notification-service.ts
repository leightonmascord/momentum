/**
 * Browser notification service for critical study events.
 *
 * Checks `Notification.permission` at call time rather than relying on a
 * module-level cache, so previously-granted permissions survive page reloads.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof Notification === 'undefined') return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  const result = await Notification.requestPermission()
  return result === 'granted'
}

export function sendNotification(title: string, body: string, tag?: string) {
  if (typeof Notification === 'undefined') return
  if (Notification.permission !== 'granted') return
  try {
    new Notification(title, { body, icon: '/favicon.svg', tag })
  } catch {
    // Notification API not available in this context
  }
}
