const colors = [
  "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  "bg-amber-500/10 text-amber-800 dark:text-amber-300",
  "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  "bg-cyan-500/10 text-cyan-800 dark:text-cyan-300",
];

// Stable IDs keep a tag's color consistent when its name changes.
export function tagColor(id: string): string {
  let hash = 0;
  for (const char of id)
    hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  return colors[hash % colors.length];
}
