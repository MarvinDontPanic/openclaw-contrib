import type { ChatQueueItem } from "./ui-types";

const QUEUE_KEY_PREFIX = "openclaw.chatQueue.";

export function loadQueuedMessages(sessionKey: string): ChatQueueItem[] {
  try {
    const key = QUEUE_KEY_PREFIX + sessionKey;
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ChatQueueItem[];
    // Filter out stale items (older than 24h)
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return parsed.filter((item) => item.createdAt > cutoff);
  } catch {
    return [];
  }
}

export function saveQueuedMessages(sessionKey: string, queue: ChatQueueItem[]) {
  try {
    const key = QUEUE_KEY_PREFIX + sessionKey;
    if (queue.length === 0) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify(queue));
    }
  } catch {
    // Ignore localStorage errors (Safari private mode, quota exceeded)
  }
}
