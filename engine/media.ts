/**
 * Images and videos agents made, for the chat. Read-only: only a file inside a
 * compiled profile, only by extension from the list below, and never `.env`
 * (it has no media extension). Symlinks are resolved before the check.
 */
import { realpath, stat } from "node:fs/promises";
import { extname, sep } from "node:path";

export const MEDIA_TYPES: Readonly<Record<string, string>> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
};
const MAX_BYTES = 512 * 1024 * 1024;

export class MediaError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** The real path, type and size of `file`, if it is a media file inside `profileDir`. */
export async function mediaFile(profileDir: string, file: string): Promise<{ abs: string; type: string; size: number }> {
  const type = MEDIA_TYPES[extname(file).toLowerCase()];
  if (!type) throw new MediaError(415, "not an image or video");
  const [dir, abs] = await Promise.all([realpath(profileDir), realpath(file)]).catch(() => {
    throw new MediaError(404, "no such file");
  });
  if (!abs.startsWith(dir + sep)) throw new MediaError(403, "that file is not in this agent's folder");
  const s = await stat(abs);
  if (!s.isFile()) throw new MediaError(404, "no such file");
  if (s.size > MAX_BYTES) throw new MediaError(413, "too large to show");
  return { abs, type, size: s.size };
}
