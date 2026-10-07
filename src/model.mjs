export const LIMITS = { fileBytes: 50 * 1024 * 1024, totalBytes: 150 * 1024 * 1024, pages: 100, imagePixels: 40_000_000, renderPixels: 8_000_000 };
export function rectangle(a, b) {
  const clamp = v => Math.min(1, Math.max(0, v));
  const x = Math.min(clamp(a.x), clamp(b.x)), y = Math.min(clamp(a.y), clamp(b.y));
  return {x, y, width: Math.max(clamp(a.x), clamp(b.x)) - x, height: Math.max(clamp(a.y), clamp(b.y)) - y};
}
export function validRegion(r) {
  return ['x','y','width','height'].every(k => Number.isFinite(r[k])) && r.x >= 0 && r.y >= 0 && r.width > 0 && r.height > 0 && r.x + r.width <= 1.000001 && r.y + r.height <= 1.000001;
}
export function exportDocument(sources, pages) {
  const round = n => Math.round(n * 1e6) / 1e6;
  return {
    schema_version: '1.0', exported_at: new Date().toISOString(),
    coordinate_system: {origin: 'top-left', x_direction: 'right', y_direction: 'down', units: 'normalized_0_to_1', reference: 'displayed full image or rotated PDF CropBox; independent of zoom', rectangle_format: 'x, y, width, height', conversion: 'multiply x/width by original.width and y/height by original.height'},
    instructions_for_ai: 'This JSON contains user feedback comments with specified locations within the separately attached images or PDF. Original image data is not included in this JSON. The user supplies this JSON and the original files manually. If no images or PDF are attached, ask the user to attach the images or PDF used for these comments. Match each pages entry to an attached original using file_name and page_number (1-based). file_id is only a reference inside this export, not an external retrieval ID. If duplicate names or missing originals make the target unclear, ask the user for clarification; do not guess. Interpret each comment verbatim as a requested revision to its specified region of that original. Region x, y, width, and height are fractions from 0 to 1, measured from the top-left of the displayed full image or rotated PDF CropBox; x goes right and y goes down. Multiply x and width by original.width, and y and height by original.height to locate the region in the stated original.unit (px for images, pt for PDFs); respect original.rotation_degrees for PDFs.',
    files: sources.filter(s=>pages.some(p=>p.sourceId===s.id)).map(s => ({file_id: s.id, file_name: s.name, type: s.type, size_bytes: s.size, page_count: s.pageCount, included_page_count: pages.filter(p=>p.sourceId===s.id).length, included_page_numbers: pages.filter(p=>p.sourceId===s.id).map(p=>p.number)})),
    pages: pages.map(p => ({page_id: p.id, file_id: p.sourceId, file_name: p.name, page_number: p.number, original: {width: p.width, height: p.height, unit: p.unit, rotation_degrees: p.rotation}, comments: p.comments.map((c,i) => ({comment_id: c.id, number: i+1, region: Object.fromEntries(Object.entries(c.region).map(([k,v]) => [k,round(v)])), comment: c.text}))}))
  };
}
