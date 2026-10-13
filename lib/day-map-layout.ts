export type MapPoint = { itemId: string; lat: number; lng: number; category?: string; categoryType?: string };
export function markerCategory(type = '') {
  if (/restaurant|cafe|coffee|food|bar|bakery/.test(type)) return 'food';
  if (/hotel|lodging|motel|resort|hostel/.test(type)) return 'hotel';
  return 'attraction';
}
// Google's world-pixel Mercator projection, using the same explicit center/zoom as the image.
export function dayMapLayout(points: MapPoint[]) {
  const valid = points.filter(point => Number.isFinite(point.lat) && Math.abs(point.lat) <= 90 && Number.isFinite(point.lng) && Math.abs(point.lng) <= 180);
  if (!valid.length) return null;
  const project = (lat: number) => { const sin = Math.sin(Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI / 180); return .5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI); };
  const firstX = (valid[0].lng + 180) / 360;
  const projected = valid.map(point => { let x = (point.lng + 180) / 360; while (x - firstX > .5) x--; while (x - firstX < -.5) x++; return { point, x, y: project(point.lat) }; });
  const xs = projected.map(point => point.x), ys = projected.map(point => point.y);
  const xmin = Math.min(...xs), xmax = Math.max(...xs), ymin = Math.min(...ys), ymax = Math.max(...ys);
  const cx = (xmin + xmax) / 2, cy = (ymin + ymax) / 2;
  const zoom = Math.max(0, Math.min(16, Math.floor(Math.min(Math.log2(512 / (256 * Math.max(xmax - xmin, 1e-9))), Math.log2(220 / (256 * Math.max(ymax - ymin, 1e-9)))))));
  const world = 256 * 2 ** zoom;
  return { center: { lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * cy))) * 180 / Math.PI, lng: ((cx * 360 % 360) + 360) % 360 - 180 }, zoom,
    markers: projected.map(({ point, x, y }) => ({ itemId: point.itemId, x: (320 + (x - cx) * world) / 640 * 100, y: (180 + (y - cy) * world) / 360 * 100, kind: markerCategory(point.categoryType) })) };
}
