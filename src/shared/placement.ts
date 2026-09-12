import type { Corner, Edge, Notch } from "./contracts";
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Dock {
  edge: Edge;
  offset: number;
  corner?: Corner | undefined;
}
const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export function dockAt(
  area: Rect,
  point: { x: number; y: number; width?: number; height?: number },
): Dock {
  const right = point.x + (point.width ?? 0);
  const bottom = point.y + (point.height ?? 0);
  const nearLeft = Math.abs(point.x - area.x) <= 64;
  const nearRight = Math.abs(right - area.x - area.width) <= 64;
  const nearTop = Math.abs(point.y - area.y) <= 64;
  const nearBottom = Math.abs(bottom - area.y - area.height) <= 64;
  const corner: Corner | undefined = nearTop
    ? nearLeft
      ? "top-left"
      : nearRight
        ? "top-right"
        : undefined
    : nearBottom
      ? nearLeft
        ? "bottom-left"
        : nearRight
          ? "bottom-right"
          : undefined
      : undefined;
  const distances: [Edge, number][] = [
    ["top", Math.abs(point.y - area.y)],
    ["bottom", Math.abs(bottom - area.y - area.height)],
    ["left", Math.abs(point.x - area.x)],
    ["right", Math.abs(right - area.x - area.width)],
  ];
  const edge = corner
    ? corner.startsWith("top")
      ? "top"
      : "bottom"
    : distances.reduce((a, b) => (b[1] < a[1] ? b : a))[0];
  const horizontal = edge === "top" || edge === "bottom";
  return {
    ...(corner ? { corner } : {}),
    edge,
    offset: clamp(
      horizontal
        ? (point.x + (point.width ?? 0) / 2 - area.x) / area.width
        : (point.y + (point.height ?? 0) / 2 - area.y) / area.height,
      0,
      1,
    ),
  };
}

export function panelBounds(
  area: Rect,
  requestedHeight: number,
  notch: Notch | null = null,
  dock: Dock = { edge: "top", offset: 0.5 },
  extension = 0,
  cornerUsageHeight = 0,
): Rect {
  const side = dock.edge === "left" || dock.edge === "right";
  const expanded = requestedHeight > 40;
  const compactCorner = !expanded && Boolean(dock.corner);
  const width = Math.min(
    Math.max(
      expanded ? 420 : dock.corner ? 112 : side ? 48 : 360,
      notch ? notch.width + 176 : 0,
    ),
    area.width,
  );
  const height = Math.min(
    Math.max(
      compactCorner ? 76 + cornerUsageHeight : side ? 160 : 40,
      Math.min(340, requestedHeight),
    ),
    area.height,
  );
  const center = clamp(dock.offset, 0, 1);
  const base = {
    x: Math.round(
      dock.corner?.endsWith("left") || dock.edge === "left"
        ? area.x
        : dock.corner?.endsWith("right") || dock.edge === "right"
          ? area.x + area.width - width
          : area.x +
            clamp(
              notch?.centerX ?? area.width * center,
              width / 2,
              area.width - width / 2,
            ) -
            width / 2,
    ),
    y: Math.round(
      dock.edge === "top"
        ? area.y
        : dock.edge === "bottom"
          ? area.y + area.height - height
          : area.y +
            clamp(area.height * center, height / 2, area.height - height / 2) -
            height / 2,
    ),
    width,
    height,
  };
  // Keep the camera cutout and original header in place; grow only to their right.
  const extendedWidth = Math.min(
    width + (compactCorner ? 0 : Math.max(0, extension)),
    area.width,
  );
  return {
    ...base,
    x: notch ? base.x : Math.min(base.x, area.x + area.width - extendedWidth),
    width: notch
      ? Math.min(extendedWidth, area.x + area.width - base.x)
      : extendedWidth,
  };
}

/** Keep the complete panel on the target display while the pointer is captured. */
export function dragBounds(
  area: Rect,
  panel: Rect,
  point: { x: number; y: number },
  grab: { x: number; y: number },
): Rect {
  const width = Math.min(panel.width, area.width);
  const height = Math.min(panel.height, area.height);
  return {
    x: Math.round(clamp(point.x - grab.x, area.x, area.x + area.width - width)),
    y: Math.round(
      clamp(point.y - grab.y, area.y, area.y + area.height - height),
    ),
    width,
    height,
  };
}

export function moveDock(
  area: Rect,
  dock: Dock,
  direction: Edge,
  nudge: boolean,
): Dock {
  const horizontal = dock.edge === "top" || dock.edge === "bottom";
  const along = horizontal
    ? direction === "left" || direction === "right"
    : direction === "top" || direction === "bottom";
  if (!nudge || !along) return { edge: direction, offset: 0.5 };
  const offset = clamp(
    dock.offset +
      ((direction === "left" || direction === "top" ? -1 : 1) * 24) /
        (horizontal ? area.width : area.height),
    0,
    1,
  );
  return dockAt(area, {
    x: horizontal
      ? area.x + offset * area.width
      : dock.edge === "left"
        ? area.x
        : area.x + area.width,
    y: horizontal
      ? dock.edge === "top"
        ? area.y
        : area.y + area.height
      : area.y + offset * area.height,
  });
}
