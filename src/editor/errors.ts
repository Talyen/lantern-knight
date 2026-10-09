import { z } from 'zod';
export function editorError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  let issues: unknown = error instanceof z.ZodError ? error.issues : undefined;
  if (!issues && message.startsWith('['))
    try {
      issues = JSON.parse(message);
    } catch {
      /* Ordinary messages stay intact. */
    }
  if (
    Array.isArray(issues) &&
    issues.length &&
    issues.every((p) => p && typeof p.message === 'string' && Array.isArray(p.path))
  )
    return issues
      .slice(0, 3)
      .map((p) => `${p.path.join('.') || 'Scene'}: ${p.message}`)
      .join('; ');
  return message;
}
