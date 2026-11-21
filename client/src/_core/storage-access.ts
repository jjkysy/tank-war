// Storage Access API shim (DESIGN §5.6).
//
// When the app is embedded in a third-party iframe, the browser blocks the
// cookies the session needs. `requestStorageAccess()` asks the user for
// permission once; outside an iframe it is a no-op.
//
// Kept separate from the upload helper so auth can call it without pulling in
// the upload flow.
export async function requestStorageAccessIfEmbedded(): Promise<void> {
  try {
    if (typeof document === "undefined") return;
    if (window.self === window.top) return; // not embedded
    const doc = document as Document & { requestStorageAccess?: () => Promise<void> };
    if (typeof doc.requestStorageAccess === "function") {
      await doc.requestStorageAccess();
    }
  } catch {
    // Denied or unsupported — the session cookie may still work; let the
    // request proceed and surface a real auth error if it does not.
  }
}
