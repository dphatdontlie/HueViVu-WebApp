import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { getAuthUserId } from '@/lib/auth';
import { adaptTrip } from '@/lib/trip-adapter';
import { normalizeTripState, getDayProgress } from '@/lib/trip-state';
import { logger } from '@/lib/logger';

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  try {
    const userId = getAuthUserId(req);
    if (!userId) return Response.json({ error: 'Cần đăng nhập hoặc phiên khách hợp lệ' }, { status: 401 });
    const input = await req.json().catch(() => null);
    if (!input || typeof input !== 'object' || Array.isArray(input) || !['late', 'rain', 'hungry', 'tired', 'closed'].includes(input.scenario)) {
      return Response.json({ error: 'Tình huống không hợp lệ' }, { status: 400 });
    }
    const db = getDb();
    const trip = db.prepare('SELECT * FROM trips WHERE id = ? AND user_id = ?').get(params.id, userId) as any;
    if (!trip) return Response.json({ error: 'Không tìm thấy lịch trình hoặc bạn không có quyền sửa' }, { status: 404 });
    const current = JSON.parse(trip.itinerary || '{}');
    if (!Number.isInteger(input.dayIndex) || !current.days?.[input.dayIndex] || (input.currentTime !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.currentTime))) return Response.json({ error: 'Hãy chọn ngày và giờ hợp lệ.' }, { status: 400 });
    if (input.preview !== true && typeof input.expectedItinerary === 'string' && input.expectedItinerary !== trip.itinerary) return Response.json({ error: 'Lịch trình vừa thay đổi. Hãy xem lại phương án trước khi áp dụng.' }, { status: 409 });
    const stateRow = db.prepare('SELECT * FROM trip_state WHERE trip_id = ? AND user_id = ?').get(params.id, userId) as { updated_at?: string } | undefined;
    const state = normalizeTripState(stateRow, params.id, current.days || []);
    const progress = getDayProgress(state, input.dayIndex, current.days[input.dayIndex].activities || []);
    if (input.scenario === 'closed' && (!Number.isInteger(input.activityIndex) || !current.days[input.dayIndex].activities?.[input.activityIndex])) {
      return Response.json({ error: 'Hãy mở một điểm chưa đi trong ngày để HueViVu tìm nơi thay thế.' }, { status: 400 });
    }
    if (input.preview !== true && Object.prototype.hasOwnProperty.call(input, 'expectedStateUpdatedAt') && input.expectedStateUpdatedAt !== (stateRow?.updated_at || null)) return Response.json({ error: 'Tiến độ vừa thay đổi. Hãy xem lại phương án để giữ nguyên các điểm đã đi.' }, { status: 409 });
    if (input.scenario === 'closed' && progress.completedActivityIndexes.includes(input.activityIndex)) return Response.json({ error: 'Điểm này đã hoàn thành. Hãy chọn điểm chưa đi để thay thế.' }, { status: 400 });
    let result: ReturnType<typeof adaptTrip>;
    try {
      result = adaptTrip(current, { ...input, completedActivityIndexes: progress.completedActivityIndexes });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Chưa có điểm cùng loại')) {
        return Response.json({ preview: input.preview === true, changed: false, itinerary: current, changes: [], message: error.message });
      }
      throw error;
    }
    const changed = JSON.stringify(current.days.map((day: any) => day.activities)) !== JSON.stringify(result.itinerary.days.map((day: any) => day.activities));
    if (!changed) return Response.json({ preview: input.preview === true, changed: false, itinerary: current, changes: [], message: result.changes.length ? result.changes[0] : 'Không có thay đổi phù hợp lúc này. Các hoạt động có thể đã qua giờ hoặc chưa có điểm thay thế; lịch hiện tại vẫn được giữ.' });
    if (input.preview === true) return Response.json({ preview: true, itinerary: result.itinerary, changes: result.changes, expectedItinerary: trip.itinerary, expectedStateUpdatedAt: stateRow?.updated_at || null });
    db.prepare('UPDATE trips SET itinerary = ?, ai_insight = ? WHERE id = ?').run(
      JSON.stringify(result.itinerary), `⚡ ${result.changes.join('. ')}`, params.id,
    );
    return Response.json({ success: true, itinerary: result.itinerary, changes: result.changes });
  } catch (error: any) {
    logger.error('Trip adapt error', { error: error?.message, tripId: params.id });
    return Response.json({ error: 'Không thể thích nghi lịch trình do lỗi hệ thống. Lịch trình hiện tại vẫn được giữ.' }, { status: 500 });
  }
}
