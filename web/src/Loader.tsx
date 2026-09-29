import { MARK } from './brand';

/*
 * Loading states. PageLoader fills the screen while a page or the session loads (it fades in after a
 * moment, so quick loads never flash). PanelLoader sits inside a card or panel. Reduced motion: no spin.
 */
export function PageLoader({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="ld-page" role="status" aria-live="polite">
      <div className="ld-mark">
        <svg viewBox={MARK.viewBox} aria-hidden="true"><path d={MARK.j} fill="currentColor" /><path d={MARK.dot} fill="#E0461F" /></svg>
        <span className="ld-ring" aria-hidden="true" />
      </div>
      <p>{label}…</p>
    </div>
  );
}

export function PanelLoader({ label = 'Loading' }: { label?: string }) {
  return <div className="ld-panel" role="status" aria-live="polite"><span className="ld-spin" aria-hidden="true" /><span>{label}…</span></div>;
}
