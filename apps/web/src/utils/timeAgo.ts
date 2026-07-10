/**
 * Lightweight relative-time formatter (no deps).
 * Returns strings like "just now", "2m ago", "1h ago", "yesterday", "3d ago".
 */
export function timeAgo(epoch: number): string {
  const now = Date.now();
  const diff = now - epoch;
  if (diff < 0) return "just now";

  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";

  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;

  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;

  const days = Math.floor(hr / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;

  return `${Math.floor(months / 12)}y ago`;
}
