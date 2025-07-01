const COMMON_MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".htm": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".txt": "text/plain",
  ".xml": "application/xml",

  ".gif": "image/gif",
  ".ico": "image/vnd.microsoft.icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",

  ".woff": "font/woff",
  ".woff2": "font/woff2",

  ".mp4": "video/mp4",
  ".webm": "video/webm",

  ".zip": "application/zip",

  ".pdf": "application/pdf",
};

export function getFileExtension(path: string): string | undefined {
  const lastSlash = path.lastIndexOf("/");
  const filename = path.slice(lastSlash + 1);
  const dotIndex = filename.lastIndexOf(".");

  if (dotIndex === -1) {
    return undefined;
  }

  return filename.slice(dotIndex).toLowerCase();
}

export function getMimeType(path: string): string | undefined {
  const ext = getFileExtension(path);
  return ext ? COMMON_MIME_TYPES[ext] : undefined;
}
