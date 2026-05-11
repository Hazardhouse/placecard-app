/**
 * Copy text to the clipboard with graceful fallback.
 *
 * `navigator.clipboard.writeText` silently fails (or throws) in these common cases:
 *   - Non-secure contexts (http:// on a LAN IP like 192.168.x.x)
 *   - Cross-origin iframes without permission
 *   - Older browsers
 *
 * We try the modern API first, then fall back to the legacy `execCommand` hack.
 * Returns `true` if either succeeded, `false` if both failed.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  // Modern async Clipboard API — only available in secure contexts
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to legacy path
    }
  }

  // Legacy fallback — works on http:// and older browsers
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    // Offscreen but still focusable
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "0";
    ta.setAttribute("readonly", "");
    document.body.appendChild(ta);

    const selection = document.getSelection();
    const savedRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");

    document.body.removeChild(ta);

    // Restore previous selection if any
    if (savedRange && selection) {
      selection.removeAllRanges();
      selection.addRange(savedRange);
    }

    return ok;
  } catch {
    return false;
  }
}
