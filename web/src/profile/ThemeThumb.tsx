/*
 * A tiny, non-interactive preview of a theme for the picker (120×180). It renders a real .pf
 * at 360×540 with placeholder content and scales it down, so it always matches themes.css.
 */
import './profile.css';
import './themes.css';

export function ThemeThumb({ id }: { id: string }) {
  return (
    <div className="pf-thumb" aria-hidden="true">
      <div className="pf" data-theme={id} data-layout="links" data-preview="">
        <div className="pf-bg" />
        <div className="pf-page">
          <div className="pf-head">
            <span className="pf-avatar pf-initials">S</span>
            <div className="pf-name">Your name</div>
            <p className="pf-handle">@you</p>
          </div>
          <div className="pf-items">
            {[0, 1, 2].map((i) => (
              <div key={i} className="pf-link" data-highlight={i === 0 ? '' : undefined} data-thumb-short={i === 2 ? '' : undefined}>
                <span className="pf-link-icon"><span className="pf-letter">{'AKM'[i]}</span></span>
                <span className="pf-link-text"><b><i className="pf-thumb-bar" /></b></span>
                <span className="pf-link-go" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
