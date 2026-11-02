import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { v4 as uuidv4 } from 'uuid';
import { requireAdmin } from '@/lib/auth';
import { logger } from '@/lib/logger';

const JSON_FIELDS = ['gallery', 'place_ids', 'highlights', 'includes', 'excludes', 'tags'];

function parseTour(t: any) {
  JSON_FIELDS.forEach(f => { try { t[f] = JSON.parse(t[f] || '[]'); } catch { t[f] = []; } });
  return t;
}

export async function GET() {
  const db = getDb();
  const tours = db.prepare('SELECT * FROM tours ORDER BY sort_order ASC, created_at DESC').all() as any[];
  tours.forEach(parseTour);
  return Response.json(tours);
}

export async function POST(req: NextRequest) {
  try {
    const admin = requireAdmin(req);
    if (admin instanceof Response) return admin;
    const db = getDb();
    const d = await req.json();
    const id = 'tour_' + uuidv4().replace(/-/g, '').slice(0, 12);
    const slug = d.slug || d.title?.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || id;

    db.prepare(`INSERT INTO tours
      (id, title, slug, description, short_desc, theme, duration_hours, price, original_price,
       cover_img, gallery, place_ids, highlights, includes, excludes,
       difficulty, max_people, rating, review_count, tags, is_featured, is_active, sort_order)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, d.title || '', slug, d.description || '', d.short_desc || '',
      d.theme || 'classic', d.duration_hours ?? 8, d.price ?? 0, d.original_price ?? 0,
      d.cover_img || '/assets/citadel.png',
      JSON.stringify(d.gallery || []), JSON.stringify(d.place_ids || []),
      JSON.stringify(d.highlights || []), JSON.stringify(d.includes || []),
      JSON.stringify(d.excludes || []),
      d.difficulty || 'easy', d.max_people ?? 10, d.rating ?? 4.8, d.review_count ?? 0,
      JSON.stringify(d.tags || []), d.is_featured ? 1 : 0, d.is_active !== false ? 1 : 0, d.sort_order ?? 0
    );

    return Response.json({ id, slug });
  } catch (err: any) {
    logger.error('Tour creation error', { error: err?.message });
    return Response.json({ error: 'Không thể tạo tour do lỗi hệ thống.' }, { status: 500 });
  }
}
