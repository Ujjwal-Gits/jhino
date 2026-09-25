/*
 * A small preview of a links-page design for the picker. It is the real page structure with
 * placeholder content, scaled down, so it always matches what visitors see.
 */
import { themeById, themeVars } from './themes';
import './fonts.css';
import './profile.css';

export function ThemeThumb({ id }: { id: string }) {
  const t = themeById(id);
  return (
    <div className="pf-thumb" aria-hidden="true">
      <div className="pf" data-theme={t.id} data-btn={t.btn} data-caps={t.caps ? '' : undefined} data-preview="" style={themeVars(t)}>
        <div className="pf-page">
          <div className="pf-head">
            <span className="pf-avatar pf-initials">S</span>
            <div className="pf-name">Sur Studio</div>
          </div>
          <div className="pf-items">
            {['Book a session', 'Showreel', 'Price list'].map((l, i) => (
              <div key={l} className="pf-link" data-highlight={i === 0 ? '' : undefined}>
                <span className="pf-link-icon"><span className="pf-letter">{l[0]}</span></span>
                <span className="pf-link-text"><b>{l}</b></span>
                <span className="pf-link-go" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
