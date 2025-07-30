// https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/MIME_types/Common_types
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

export function getExtension(path: string): string | undefined {
  const filename = path.split("/").pop();
  if (!filename) {
    return;
  }
  const separatorIndex = filename.lastIndexOf(".");
  if (separatorIndex !== -1) {
    return filename.slice(separatorIndex);
  }
}

export function getType(ext: string | undefined): string | undefined {
  return ext ? COMMON_MIME_TYPES[ext] : undefined;
}
