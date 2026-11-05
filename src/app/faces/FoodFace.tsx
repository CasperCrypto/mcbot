import { useId, useMemo } from "react";
import { foodSvg, logoSvg, type Expression } from "./foods";

/** A glass food bot. Same name, same bot: the shape and colour come from the seed. */
export function FoodFace({ seed, size = 32, expression = "idle", title }: { seed: string; size?: number; expression?: Expression; title?: string }) {
  const uid = useId();
  const html = useMemo(() => foodSvg({ seed, size, expression, uid: `f${uid}`, title }), [seed, size, expression, uid, title]);
  return <span className="food-face" style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** The McBot logo. */
export function Logo({ size = 22 }: { size?: number }) {
  const uid = useId();
  const html = useMemo(() => logoSvg(size, `l${uid}`, ""), [size, uid]);
  return <span className="food-face brand-mark" style={{ width: size, height: size }} aria-hidden dangerouslySetInnerHTML={{ __html: html }} />;
}
