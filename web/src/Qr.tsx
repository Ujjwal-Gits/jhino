import qrcode from 'qrcode-generator';
import { useMemo } from 'react';

/** A QR code drawn as SVG squares (no HTML strings): for authenticator setup and sharing links. */
export function Qr({ text, size = 200, label }: { text: string; size?: number; label: string }) {
  const { n, path } = useMemo(() => {
    const q = qrcode(0, 'M');
    q.addData(text);
    q.make();
    const count = q.getModuleCount();
    let d = '';
    for (let r = 0; r < count; r++) for (let c = 0; c < count; c++) if (q.isDark(r, c)) d += `M${c + 4} ${r + 4}h1v1h-1z`;
    return { n: count + 8, path: d };
  }, [text]);
  return (
    <svg className="qr" viewBox={`0 0 ${n} ${n}`} width={size} height={size} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={n} height={n} fill="#fff" />
      <path d={path} fill="#141414" />
    </svg>
  );
}
