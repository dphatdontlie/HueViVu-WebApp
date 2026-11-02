import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { getAuthUserId } from '@/lib/auth';
import { suggestTripInsertion } from '@/lib/trip-insertion';
import { logger } from '@/lib/logger';

// POST /api/trips/[id]/add-place
// body: { dayIndex: number, activity: Activity }
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  try {
    const userId = getAuthUserId(req);
    if (!userId) return Response.json({ error: 'Cần đăng nhập hoặc phiên khách hợp lệ' }, { status: 401 });
    const body = await req.json();
    const { dayIndex, activity, placeId, smartInsert = false } = body;

    if (dayIndex === undefined || (!activity?.name && !placeId)) {
      return Response.json({ error: 'Thiếu thông tin' }, { status: 400 });
    }

    const db = getDb();
    const trip = db.prepare('SELECT * FROM trips WHERE id = ?').get(params.id) as any;
    if (!trip) return Response.json({ error: 'Trip not found' }, { status: 404 });

    // Allow owner or demo user
    if (trip.user_id !== userId) {
      return Response.json({ error: 'Không có quyền chỉnh sửa' }, { status: 403 });
    }

    const itinerary = JSON.parse(trip.itinerary || '{}');
    const days: any[] = itinerary.days || [];

    const di = Number(dayIndex);
    if (di < 0 || di >= days.length) {
      return Response.json({ error: 'Ngày không hợp lệ' }, { status: 400 });
    }

    const existing = days[di].activities || [];
    const place = placeId ? db.prepare('SELECT * FROM places WHERE id = ?').get(placeId) as any : null;
    if (placeId && !place) return Response.json({ error: 'Không tìm thấy địa điểm' }, { status: 404 });

    const nextActivity = place ? {
      time: activity?.time || '10:00', name: place.name, type: place.category,
      duration: place.duration || `${Math.max(30, Number(place.avg_visit_min) || 60)} phút`,
      cost: place.price || 'Miễn phí', description: place.description || '',
      location: place.address || 'Huế', ai_tip: place.ai_insight || 'Được chèn theo tuyến đường và khoảng trống phù hợp.',
      lat: place.lat, lng: place.lng, place_id: place.id,
    } : activity;

    if (existing.some((item: any) => item.place_id === nextActivity.place_id || item.name === nextActivity.name)) {
      return Response.json({ error: 'Địa điểm này đã có trong ngày đã chọn' }, { status: 409 });
    }

    let suggestion = null;
    if (smartInsert && place) {
      suggestion = suggestTripInsertion(existing, place);
      if (!suggestion.feasible) return Response.json({ error: suggestion.reason, suggestion }, { status: 409 });
      nextActivity.time = suggestion.time;
      nextActivity.ai_tip = `${nextActivity.ai_tip} ${suggestion.reason}`.trim();
    }

    const conflict = existing.find((a: any) => {
      const [ah, am] = (a.time || '').split(':').map(Number);
      const [nh2, nm2] = (nextActivity.time || '10:00').split(':').map(Number);
      return Math.abs((ah * 60 + am) - (nh2 * 60 + nm2)) < 30;
    });
    if (conflict) {
      return Response.json({ error: `Trùng giờ với "${conflict.name}"`, conflict: conflict.name }, { status: 409 });
    }

    // Insert and sort by time
    days[di].activities = [...existing, nextActivity].sort((a, b) => {
      const [ah, am] = (a.time || '').split(':').map(Number);
      const [bh, bm] = (b.time || '').split(':').map(Number);
      return (ah * 60 + am) - (bh * 60 + bm);
    });

    itinerary.days = days;
    db.prepare('UPDATE trips SET itinerary = ? WHERE id = ?').run(JSON.stringify(itinerary), params.id);

    return Response.json({ success: true, suggestion, trip: { ...trip, itinerary } });
  } catch (err: any) {
    logger.error('Add place to trip error', { error: err?.message, tripId: params.id });
    return Response.json({ error: 'Không thể thêm địa điểm vào lịch trình do lỗi hệ thống.' }, { status: 500 });
  }
}
