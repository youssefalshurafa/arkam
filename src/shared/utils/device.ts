// Friendly "Browser on OS" label for the device that downloaded a backup, so the
// last-backup indicator can say where it came from. Best-effort UA parsing.
export function getDeviceLabel(): string {
 if (typeof navigator === 'undefined') return 'Unknown device';
 const ua = navigator.userAgent;
 const os = /Windows/i.test(ua)
  ? 'Windows'
  : /iPhone/i.test(ua)
    ? 'iPhone'
    : /iPad/i.test(ua)
      ? 'iPad'
      : /Android/i.test(ua)
        ? 'Android'
        : /Mac OS X|Macintosh/i.test(ua)
          ? 'Mac'
          : /Linux/i.test(ua)
            ? 'Linux'
            : 'device';
 const browser = /Edg\//i.test(ua)
  ? 'Edge'
  : /OPR\/|Opera/i.test(ua)
    ? 'Opera'
    : /Firefox/i.test(ua)
      ? 'Firefox'
      : /Chrome/i.test(ua)
        ? 'Chrome'
        : /Safari/i.test(ua)
          ? 'Safari'
          : 'Browser';
 return `${browser} on ${os}`;
}
