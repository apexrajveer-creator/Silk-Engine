export const MAX_POINTS = 4096;
export function appendPoint(points, point, width, height) {
  if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y) || points.length >= MAX_POINTS) return points;
  const p = { x: Math.max(0, Math.min(width, point.x)), y: Math.max(0, Math.min(height, point.y)) };
  const last = points.at(-1);
  if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= 2) points.push(p);
  return points;
}
export function selectionBounds(points, width, height) {
  if (points.length < 3) return null;
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const x = Math.max(0, Math.floor(Math.min(...xs))), y = Math.max(0, Math.floor(Math.min(...ys)));
  const right = Math.min(width, Math.ceil(Math.max(...xs))), bottom = Math.min(height, Math.ceil(Math.max(...ys)));
  // Use absolute triangle areas: valid figure-eight traces may have a signed area of zero.
  let area = 0;
  for (let i = 1; i + 1 < points.length; i++) area += Math.abs((points[i].x - points[0].x) * (points[i + 1].y - points[0].y) - (points[i + 1].x - points[0].x) * (points[i].y - points[0].y)) / 2;
  return right - x >= 12 && bottom - y >= 12 && area >= 80 ? { x, y, width: right - x, height: bottom - y } : null;
}
export function scaledSelection(points, viewWidth, viewHeight, imageWidth, imageHeight) {
  if (![viewWidth, viewHeight, imageWidth, imageHeight].every(v => Number.isFinite(v) && v > 0)) return null;
  const mapped = points.map(p => ({ x: Math.max(0, Math.min(imageWidth, p.x * imageWidth / viewWidth)), y: Math.max(0, Math.min(imageHeight, p.y * imageHeight / viewHeight)) }));
  const bounds = selectionBounds(mapped, imageWidth, imageHeight);
  return bounds ? { points: mapped, bounds } : null;
}
export function tracePath(ctx, points, offsetX = 0, offsetY = 0) {
  ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (i) ctx.lineTo(p.x - offsetX, p.y - offsetY); else ctx.moveTo(p.x - offsetX, p.y - offsetY);
  }
  ctx.closePath();
}
