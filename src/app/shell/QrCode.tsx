/**
 * A QR code for a link (Share: open it on a phone), drawn as one SVG path from qrcode-generator
 * (MIT). Dark on a light tile, the way phone cameras read them best.
 */
import qrcode from "qrcode-generator";
import { useMemo } from "react";

export function QrCode({ text, size = 168, label }: { text: string; size?: number; label: string }) {
  const { d, n } = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const count = qr.getModuleCount();
    let path = "";
    for (let r = 0; r < count; r++) for (let c = 0; c < count; c++) if (qr.isDark(r, c)) path += `M${c + 2} ${r + 2}h1v1h-1z`;
    return { d: path, n: count + 4 };
  }, [text]);
  return (
    <svg className="qr" width={size} height={size} viewBox={`0 0 ${n} ${n}`} role="img" aria-label={label} shapeRendering="crispEdges" data-testid="share-qr">
      <rect className="qr-bg" width={n} height={n} rx={1.5} />
      <path className="qr-fg" d={d} />
    </svg>
  );
}
