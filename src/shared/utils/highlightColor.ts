// Row / net-change highlight colors are stored as light hex values chosen for
// the light theme (e.g. #fde68a amber, #eff6ff blue). Applied verbatim on a dark
// surface they glare and wash out the now-light row text. In dark mode we blend
// the color into the surface token so it becomes a muted, dark-friendly tint that
// keeps text legible. Light mode is returned unchanged.
export function resolveHighlightBg(color: string | undefined | null, isDark: boolean): string | undefined {
 if (!color) return undefined;
 return isDark ? `color-mix(in srgb, ${color} 32%, var(--surface))` : color;
}
