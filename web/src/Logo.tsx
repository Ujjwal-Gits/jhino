import { MARK, WORDMARK } from './brand';

/** Jhino's wordmark ("Jhino." from the brand files). The letters follow the text colour; the point stays orange. */
export function Wordmark({ className = '', title = 'Jhino' }: { className?: string; title?: string }) {
  return (
    <svg className={`logo ${className}`} viewBox={WORDMARK.viewBox} role="img" aria-label={title} focusable="false">
      <path d={WORDMARK.letters} fill="currentColor" />
      <path d={WORDMARK.dot} fill="#E0461F" />
    </svg>
  );
}

/** The "J." mark on its own. */
export function Mark({ className = '' }: { className?: string }) {
  return (
    <svg className={`logo-mark ${className}`} viewBox={MARK.viewBox} aria-hidden="true" focusable="false">
      <path d={MARK.j} fill="currentColor" />
      <path d={MARK.dot} fill="#E0461F" />
    </svg>
  );
}
