// Prints a standalone HTML document (the browser's "Save as PDF" is the export path).
//
// This deliberately prints from a hidden iframe in the current page rather than a popup tab.
// A popup opened with window.open('') shares the opener's renderer process and main thread,
// so its print dialog blocks the opener too: the app tab froze for as long as the PDF tab
// stayed open, and Chrome sometimes left it unpainted even after (only F12/refresh woke it).
// An iframe keeps the dialog on the tab the user is looking at and is gone once it closes.

const FRAME_ID = 'arkam-print-frame';
// Upper bound on waiting for fonts/images; a stalled CDN must not swallow the export.
const ASSET_WAIT_MS = 4000;

function waitForAssets(frameWindow: Window): Promise<void> {
 const doc = frameWindow.document;
 // `load` covers stylesheets (the Cairo @font-face rules) and the brand logo; fonts.ready
 // then covers the font files those rules pulled in.
 const loaded =
  doc.readyState === 'complete'
   ? Promise.resolve()
   : new Promise<void>((resolve) => frameWindow.addEventListener('load', () => resolve(), { once: true }));
 const all = loaded.then(() => (doc as Document & { fonts?: FontFaceSet }).fonts?.ready).then(() => undefined);
 const timeout = new Promise<void>((resolve) => setTimeout(resolve, ASSET_WAIT_MS));
 return Promise.race([all, timeout]);
}

export function printHtml(html: string, title?: string): void {
 document.getElementById(FRAME_ID)?.remove();

 const frame = document.createElement('iframe');
 frame.id = FRAME_ID;
 frame.setAttribute('aria-hidden', 'true');
 frame.tabIndex = -1;
 // Zero-size but still rendered: display:none / visibility:hidden frames print blank in some browsers.
 frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none;';
 document.body.appendChild(frame);

 const frameWindow = frame.contentWindow;
 if (!frameWindow) {
  frame.remove();
  return;
 }

 const doc = frameWindow.document;
 doc.open();
 doc.write(html);
 doc.close();
 if (title) doc.title = title;

 void waitForAssets(frameWindow).then(() => {
  // Chrome names the saved PDF after the top-level document's title, not the frame's.
  const previousTitle = document.title;
  if (title) document.title = title;

  frameWindow.addEventListener(
   'afterprint',
   () => {
    document.title = previousTitle;
    // Deferred so browsers whose print() returns before the job is spooled can finish.
    // If afterprint never fires, the next export removes the stale frame instead.
    setTimeout(() => frame.remove(), 1000);
   },
   { once: true },
  );

  frameWindow.focus();
  frameWindow.print();
 });
}
