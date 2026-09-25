import { useState } from 'react';
import { Qr } from '../Qr';

/*
 * Send a link the way people here actually do: WhatsApp, Viber, a text message, or a QR code to scan
 * across the table (or print on a card).
 */
export function ShareOut({ url, text }: { url: string; text: string }) {
  const [qr, setQr] = useState(false);
  const msg = `${text} ${url}`;
  return (
    <div className="share-out">
      <div className="share-out-row">
        <a className="btn sm" href={`https://wa.me/?text=${encodeURIComponent(msg)}`} target="_blank" rel="noopener">WhatsApp</a>
        <a className="btn sm" href={`viber://forward?text=${encodeURIComponent(msg)}`}>Viber</a>
        <a className="btn sm" href={`sms:?&body=${encodeURIComponent(msg)}`}>Text message</a>
        <button type="button" className="btn sm" aria-expanded={qr} onClick={() => setQr(!qr)}>{qr ? 'Hide QR code' : 'QR code'}</button>
      </div>
      {qr && (
        <figure className="share-qr">
          <Qr text={url} size={168} label={`QR code for ${url}`} />
          <figcaption className="hint">Scan with a phone camera to open it. Right-click (or long-press) to save and print it.</figcaption>
        </figure>
      )}
    </div>
  );
}
