/**
 * Tidy left-to-right tree layout for the Files and Memory graphs.
 * Leaves stack top to bottom; a parent sits at the vertical middle of its
 * children. Pure: same tree in, same positions out.
 */
export interface TreeIn {
  id: string;
  /** Rendered height of this node (defaults to opts.row). */
  height?: number;
  children?: TreeIn[];
}

export interface TreeOpts {
  /** Horizontal distance between depths. */
  column: number;
  /** Default node height. */
  row: number;
  /** Vertical gap between siblings. */
  gap: number;
}

export interface Placed {
  x: number;
  y: number;
  depth: number;
}

export function layoutTree(root: TreeIn, opts: TreeOpts): Map<string, Placed> {
  const out = new Map<string, Placed>();
  let cursor = 0;
  const place = (node: TreeIn, depth: number): { top: number; bottom: number; center: number } => {
    const h = node.height ?? opts.row;
    const kids = node.children ?? [];
    if (!kids.length) {
      const top = cursor;
      cursor += h + opts.gap;
      out.set(node.id, { x: depth * opts.column, y: top, depth });
      return { top, bottom: top + h, center: top + h / 2 };
    }
    const spans = kids.map((k) => place(k, depth + 1));
    const center = (spans[0]!.center + spans[spans.length - 1]!.center) / 2;
    const y = center - h / 2;
    out.set(node.id, { x: depth * opts.column, y, depth });
    // A parent taller than its children's span must not overlap the next subtree.
    const bottom = Math.max(spans[spans.length - 1]!.bottom, y + h);
    if (bottom + opts.gap > cursor) cursor = bottom + opts.gap;
    return { top: Math.min(spans[0]!.top, y), bottom, center };
  };
  place(root, 0);
  return out;
}
