import { applyVerificationPolicy } from '@/lib/place-trust';
import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { parsePlaceRow, preparePlacePayload } from '@/lib/place-data';
import { requireAdmin, requireRoles } from '@/lib/auth';
import { writeAudit } from '@/lib/audit';
import { logger } from '@/lib/logger';

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  const db = getDb();
  const place = db.prepare('SELECT * FROM places WHERE id = ?').get(params.id) as any;
  if (!place) return Response.json({ error: 'Place not found' }, { status: 404 });
  if (place.publication_status !== 'published') {
    const access = requireRoles(req, ['admin', 'reviewer', 'collector']);
    if (access instanceof Response) return Response.json({ error: 'Place not found' }, { status: 404 });
  }

  return Response.json(parsePlaceRow(place));
}

// PUT /api/places/[id]
export async function PUT(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  try {
    const access = requireRoles(req, ['admin', 'reviewer', 'collector']);
    if (access instanceof Response) return access;
    const db = getDb();
    const data = await req.json();

    const p = preparePlacePayload(data);
    if (p.verification_status === 'verified' && !['admin', 'reviewer'].includes(access.role)) {
      return Response.json({ error: 'Collector không thể tự xác minh địa điểm' }, { status: 403 });
    }
    const before = db.prepare('SELECT * FROM places WHERE id = ?').get(params.id);
    if (!before) return Response.json({ error: 'Place not found' }, { status: 404 });
    try { applyVerificationPolicy(p, before as Record<string, any>, data.confirm_verification === true); } catch (error) { return Response.json({ error: (error as Error).message }, { status: 400 }); }
    if (access.role !== 'admin') p.publication_status = (before as any).publication_status || 'published';

    const stmt = db.prepare(`
      UPDATE places SET 
        name = ?, category = ?, description = ?, address = ?, price = ?, lat = ?, lng = ?, img = ?, ai_insight = ?,
        rating = ?, popularity = ?, avg_visit_min = ?, meal_type = ?, indoor = ?,
        hours = ?, hours_time = ?, hours_note = ?, opening_hours = ?, phone = ?, website = ?,
        highlights = ?, tips = ?, tags = ?, vibe = ?, taste_profile = ?, accessibility = ?, best_time_of_day = ?, specialties = ?,
        crowd_level = ?, physical_level = ?, best_time = ?, authenticity = ?, walking_distance = ?, ideal_pacing = ?, noise_level = ?, dining_style = ?, weather_dependent = ?,
        source_name = ?, source_url = ?, verification_status = ?, verified_by = ?, verified_at = ?, verification_notes = ?, publication_status = ?, reverify_after_days = ?
      WHERE id = ?
    `);

    stmt.run(
      p.name, p.category, p.description, p.address, p.price, p.lat, p.lng, p.img, p.ai_insight,
      p.rating, p.popularity, p.avg_visit_min, p.meal_type, p.indoor,
      p.hours, p.hours_time, p.hours_note, p.opening_hours, p.phone, p.website,
      p.highlights, p.tips, p.tags, p.vibe, p.taste_profile, p.accessibility, p.best_time_of_day, p.specialties,
      p.crowd_level, p.physical_level, p.best_time, p.authenticity, p.walking_distance, p.ideal_pacing, p.noise_level, p.dining_style, p.weather_dependent,
      p.source_name, p.source_url, p.verification_status, p.verified_by, p.verified_at, p.verification_notes, p.publication_status, p.reverify_after_days,
      params.id
    );
    writeAudit(db, { actorId: access.userId, action: p.verification_status === 'verified' ? 'verify' : 'update', entityType: 'place', entityId: params.id, before, after: p, note: p.verification_notes });

    return Response.json({ message: 'Updated successfully' });
  } catch (error: any) {
    logger.error('Error updating place', { error: error?.message, placeId: params.id });
    return Response.json({ error: 'Không thể cập nhật địa điểm do lỗi hệ thống.' }, { status: 500 });
  }
}

// DELETE /api/places/[id]
export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  try {
    const admin = requireAdmin(req);
    if (admin instanceof Response) return admin;
    const db = getDb();
    const before = db.prepare('SELECT * FROM places WHERE id = ?').get(params.id);
    if (!before) return Response.json({ error: 'Place not found' }, { status: 404 });
    db.prepare('DELETE FROM places WHERE id = ?').run(params.id);
    writeAudit(db, { actorId: admin.userId, action: 'delete', entityType: 'place', entityId: params.id, before });
    return Response.json({ message: 'Deleted successfully' });
  } catch (error: any) {
    logger.error('Error deleting place', { error: error?.message, placeId: params.id });
    return Response.json({ error: 'Không thể xóa địa điểm do lỗi hệ thống.' }, { status: 500 });
  }
}
