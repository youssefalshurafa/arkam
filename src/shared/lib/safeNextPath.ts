// Validates a post-login/post-signup `?next=` destination. Only same-site absolute paths
// are allowed: anything else ("https://evil.example", "//evil.example", "/\\evil.example",
// "javascript:…") would turn the login page into an open redirect.
export function safeNextPath(value: string | null | undefined, fallback = '/'): string {
 if (!value) return fallback;
 const path = String(value).trim();
 if (!path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\') || /[\u0000-\u001f]/.test(path)) {
  return fallback;
 }
 return path;
}
