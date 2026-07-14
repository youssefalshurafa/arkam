import { minTableZoom, maxTableZoom } from '@/shared/lib/localStorage';

const ZOOM_STEP = 0.1;

// Spreadsheet-style zoom control for the wide ledger / transactions tables. Lets the
// user shrink the table (via CSS `zoom`) so every column fits on a narrow screen, then
// zoom back in to read or edit a cell. Purely presentational — state lives in the caller.
export function TableZoomControl({ zoom, onZoomChange, className = 'mt-3' }: { zoom: number; onZoomChange: (z: number) => void; className?: string }) {
 const clamp = (z: number) => Math.min(maxTableZoom, Math.max(minTableZoom, Math.round(z * 100) / 100));
 const atMin = zoom <= minTableZoom + 1e-9;
 const atMax = zoom >= maxTableZoom - 1e-9;
 const btnClassName =
  'rounded border border-border-strong px-2 py-1 text-xs font-semibold text-fg-muted transition hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50';

 return (
  <div className={`flex items-center justify-end gap-1 whitespace-nowrap ${className}`}>
   <button
    type="button"
    aria-label="Zoom out"
    className={btnClassName}
    disabled={atMin}
    onClick={() => onZoomChange(clamp(zoom - ZOOM_STEP))}
   >
    −
   </button>
   <button
    type="button"
    aria-label="Reset zoom"
    className={`${btnClassName} tabular-nums`}
    onClick={() => onZoomChange(1)}
   >
    {Math.round(zoom * 100)}%
   </button>
   <button
    type="button"
    aria-label="Zoom in"
    className={btnClassName}
    disabled={atMax}
    onClick={() => onZoomChange(clamp(zoom + ZOOM_STEP))}
   >
    +
   </button>
  </div>
 );
}
