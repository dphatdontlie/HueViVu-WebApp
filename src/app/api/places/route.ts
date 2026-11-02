import { applyVerificationPolicy } from '@/lib/place-trust';
import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { parsePlaceRow, preparePlacePayload } from '@/lib/place-data';
import { normalizePlaceCategory } from '@/lib/place-taxonomy';
import { requireRoles, getAuthUserId } from '@/lib/auth';
import { readPreferences, rankPlaces } from '@/lib/travel-preferences';
import { writeAudit } from '@/lib/audit';
import { findPlaceDuplicates } from '@/lib/place-duplicates';
import { logger } from '@/lib/logger';

// GET /api/places
export async function GET(req: NextRequest) {
  const db = getDb();
  const { searchParams } = new URL(req.url);
  const category = searchParams.get('category');
  const q = searchParams.get('q');
  const scope = searchParams.get('scope');
  const indoor = searchParams.get('indoor');
  if (indoor !== null && !['true', 'false'].includes(indoor)) return Response.json({ error: 'Lựa chọn không gian chưa hợp lệ.' }, { status: 400 });

  const conditions: string[] = [];
  const params: any[] = [];

  if (scope === 'admin') {
    const access = requireRoles(req, ['admin', 'reviewer', 'collector']);
    if (access instanceof Response) return access;
  } else {
    conditions.push("publication_status = 'published'");
  }

  if (category && category !== 'all') {
    const normalizedCategory = normalizePlaceCategory(category);
    if (!normalizedCategory) return Response.json({ error: 'Danh mục không hợp lệ' }, { status: 400 });
    conditions.push('category = ?');
    params.push(normalizedCategory);
  }
  if (q) {
    conditions.push('(name LIKE ? OR description LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  if (indoor === 'true') conditions.push('indoor = 1');

  const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
  const places = db.prepare(`SELECT * FROM places${where} ORDER BY popularity DESC, rating DESC`).all(...params) as any[];

  places.forEach(parsePlaceRow);
  if (scope !== 'admin' && searchParams.get('personalized') === 'true') {
    const userId = getAuthUserId(req);
    if (!userId) return Response.json({ error: 'Cần đăng nhập để dùng sở thích.' }, { status: 401 });
    const user = db.prepare('SELECT preferences FROM users WHERE id = ?').get(userId) as { preferences: string };
    return Response.json(rankPlaces(places, readPreferences(user.preferences)), { headers: { 'Cache-Control': 'private, no-store', Vary: 'Authorization' } });
  }
  return Response.json(places);
}

// POST /api/places
export async function POST(req: NextRequest) {
  try {
    const access = requireRoles(req, ['admin', 'reviewer', 'collector']);
    if (access instanceof Response) return access;
    const db = getDb();
    const data = await req.json();

    const id = crypto.randomUUID();
    const p = preparePlacePayload(data);
    const duplicates = findPlaceDuplicates(db, p);
    if (duplicates.some((item: any) => item.reasons.includes('Trùng tên')) && !data.allow_duplicate) {
      return Response.json({ error: 'Địa điểm có thể đã tồn tại', duplicates }, { status: 409 });
    }
    if (p.verification_status === 'verified' && !['admin', 'reviewer'].includes(access.role)) {
      return Response.json({ error: 'Collector không thể tự xác minh địa điểm' }, { status: 403 });
    }
    try { applyVerificationPolicy(p); } catch (error) { return Response.json({ error: (error as Error).message }, { status: 400 }); }
    if (p.publication_status === 'published' && access.role !== 'admin') p.publication_status = 'draft';

    const stmt = db.prepare(`
      INSERT INTO places (
        id, name, category, description, address, price, lat, lng, img, ai_insight,
        rating, popularity, avg_visit_min, meal_type, indoor, hours, hours_time, hours_note, opening_hours, phone, website,
        highlights, tips, tags, vibe, taste_profile, accessibility, best_time_of_day, specialties,
        crowd_level, physical_level, best_time, authenticity, walking_distance, ideal_pacing, noise_level, dining_style, weather_dependent,
        source_name, source_url, verification_status, verified_by, verified_at, verification_notes, publication_status, reverify_after_days
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?
      )
    `);

    stmt.run(
      id, p.name, p.category, p.description, p.address, p.price, p.lat, p.lng, p.img, p.ai_insight,
      p.rating, p.popularity, p.avg_visit_min, p.meal_type, p.indoor, p.hours, p.hours_time, p.hours_note, p.opening_hours, p.phone, p.website,
      p.highlights, p.tips, p.tags, p.vibe, p.taste_profile, p.accessibility, p.best_time_of_day, p.specialties,
      p.crowd_level, p.physical_level, p.best_time, p.authenticity, p.walking_distance, p.ideal_pacing, p.noise_level, p.dining_style, p.weather_dependent,
      p.source_name, p.source_url, p.verification_status, p.verified_by, p.verified_at, p.verification_notes, p.publication_status, p.reverify_after_days
    );
    writeAudit(db, { actorId: access.userId, action: 'create', entityType: 'place', entityId: id, after: p });

    return Response.json({ id, message: 'Created successfully' }, { status: 201 });
  } catch (error: any) {
    logger.error('Error creating place', { error: error?.message });
    return Response.json({ error: 'Không thể tạo địa điểm do lỗi hệ thống.' }, { status: 500 });
  }
}
