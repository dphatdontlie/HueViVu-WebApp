import { validateTripChange } from '@/lib/trip-change-guard';
import { groundedPlaceReply } from '@/lib/grounded-place-reply';
import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { getAuthUserId } from '@/lib/auth';
import { chat } from '@/lib/ai';
import { customizeTrip } from '@/lib/ai';
import { v4 as uuidv4 } from 'uuid';
import { suggestTripInsertion } from '@/lib/trip-insertion';
import { normalizeTripState } from '@/lib/trip-state';
import { progressReply } from '@/lib/trip-chat-progress';
import { getClientIp, checkRateLimit, rateLimitResponse, RATE_LIMIT_RULES } from '@/lib/rate-limit';

function fold(value = '') {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'd').toLowerCase();
}

function deterministicProposal(message: string, trip: any, db: any, viewedDay = 0) {
  const candidate = JSON.parse(JSON.stringify({
    title: trip.title, summary: trip.summary, total_cost_estimate: trip.total_cost_estimate,
    highlights: trip.highlights || [], ai_insight: trip.ai_insight || '',
    days: trip.itinerary?.days || [],
  }));
  const text = fold(message);
  const dayMatch = text.match(/ngay\s+(\d+)/);
  const dayIndex = Math.max(0, Math.min(candidate.days.length - 1, Number(dayMatch?.[1] || viewedDay + 1) - 1));
  const day = candidate.days[dayIndex];
  if (!day) return null;
  const times = Array.from(message.matchAll(/\b([01]?\d|2[0-3]):[0-5]\d\b/g)).map(match => match[0].padStart(5, '0'));
  const activities = day.activities || [];
  const mentioned = activities.find((activity: any) => text.includes(fold(activity.name)));

  if (/\b(bo|xoa|loai)\b/.test(text)) {
    const index = mentioned ? activities.indexOf(mentioned) : times[0] ? activities.findIndex((activity: any) => activity.time === times[0]) : -1;
    if (index < 0) return null;
    activities.splice(index, 1);
    candidate.ai_insight = `Đã bỏ ${mentioned?.name || 'hoạt động đã chọn'} theo yêu cầu của bạn.`;
    return candidate;
  }

  if (/\b(doi|doi gio|chuyen|dời|doi lich)\b/.test(text) && times.length) {
    const activity = mentioned || (times.length > 1 ? activities.find((item: any) => item.time === times[0]) : null);
    if (!activity) return null;
    activity.time = times[times.length - 1];
    activities.sort((a: any, b: any) => a.time.localeCompare(b.time));
    candidate.ai_insight = `Đã dời ${activity.name} sang ${activity.time}.`;
    return candidate;
  }

  if (/\b(them|chen)\b/.test(text)) {
    const allPlaces = db.prepare("SELECT * FROM places WHERE publication_status = 'published' ORDER BY popularity DESC, rating DESC").all() as any[];
    const existingIds = new Set(candidate.days.flatMap((item: any) => item.activities || []).map((item: any) => item.place_id));
    const exact = allPlaces.filter(place => text.includes(fold(place.name))).sort((a, b) => b.name.length - a.name.length)[0];
    const category = text.includes('ca phe') ? 'cafe' : text.includes('quan an') || text.includes('an uong') || text.includes('mon an') ? 'food' : null;
    const pool = (exact ? [exact] : allPlaces.filter(place => !category || place.category === category)).filter(place => !existingIds.has(place.id));
    const options = pool.map(place => ({ place, suggestion: suggestTripInsertion(activities, place) })).filter(item => item.suggestion.feasible)
      .sort((a, b) => a.suggestion.detourKm - b.suggestion.detourKm);
    const best = options[0];
    if (!best) return null;
    const place = best.place;
    activities.push({
      time: best.suggestion.time, name: place.name, type: place.category, duration: place.duration || '1 giờ',
      cost: place.price || 'Miễn phí', description: place.description || '', location: place.address || 'Huế',
      ai_tip: best.suggestion.reason, lat: place.lat, lng: place.lng, place_id: place.id,
    });
    activities.sort((a: any, b: any) => a.time.localeCompare(b.time));
    candidate.ai_insight = `Đã chọn ${place.name} vì phù hợp với khoảng trống và gần tuyến hiện tại.`;
    return candidate;
  }
  return null;
}

function summarizeChanges(before: any, after: any) {
  const flatten = (itinerary: any) => (itinerary?.days || []).flatMap((day: any) =>
    (day.activities || []).map((activity: any) => ({ day: day.day, name: activity.name, time: activity.time }))
  );
  const previous = flatten(before);
  const next = flatten(after);
  const previousKeys = new Set(previous.map((item: any) => `${item.day}|${item.name}`));
  const nextKeys = new Set(next.map((item: any) => `${item.day}|${item.name}`));
  const added = next.filter((item: any) => !previousKeys.has(`${item.day}|${item.name}`));
  const removed = previous.filter((item: any) => !nextKeys.has(`${item.day}|${item.name}`));
  const moved = next.filter((item: any) => {
    const old = previous.find((candidate: any) => candidate.day === item.day && candidate.name === item.name);
    return old && old.time !== item.time;
  });
  return [
    ...added.slice(0, 3).map((item: any) => `Thêm ${item.name} vào ngày ${item.day}, lúc ${item.time}`),
    ...removed.slice(0, 3).map((item: any) => `Bỏ ${item.name} khỏi ngày ${item.day}`),
    ...moved.slice(0, 3).map((item: any) => `Dời ${item.name} sang ${item.time} ngày ${item.day}`),
  ];
}

// POST /api/chat
export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const userId = getAuthUserId(req);
    const rateKey = userId ? `chat:user:${userId}` : `chat:ip:${ip}`;
    const rateCheck = checkRateLimit(rateKey, RATE_LIMIT_RULES.CHAT.limit, RATE_LIMIT_RULES.CHAT.windowMs);
    if (!rateCheck.success) {
      return rateLimitResponse(rateCheck, `Bạn đã gửi quá nhiều tin nhắn cho trợ lý AI. Vui lòng đợi ${rateCheck.retryAfterSeconds} giây trước khi gửi tiếp.`);
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return Response.json({ error: 'Tin nhắn chưa hợp lệ.' }, { status: 400 });
    const { message, tripId, history = [], dayIndex } = body;
    if (typeof message !== 'string' || !message.trim() || message.length > 2000 || (tripId !== undefined && (typeof tripId !== 'string' || !tripId || tripId.length > 200)) || !Array.isArray(history) || history.length > 20 || history.some((item: any) => !item || !['user', 'assistant'].includes(item.role) || typeof item.content !== 'string' || item.content.length > 4000) || (dayIndex !== undefined && (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex > 6))) return Response.json({ error: 'Tin nhắn hoặc ngày đang xem chưa hợp lệ.' }, { status: 400 });

    // userId đã được khai báo và kiểm tra ở đầu hàm
    const db = getDb();
    let tripContext: any = null;

    if (tripId) {
      const trip = db.prepare('SELECT title, summary, duration, style, companion, total_cost_estimate, itinerary, highlights, ai_insight, user_id, is_shared, start_date, status FROM trips WHERE id = ?').get(tripId) as any;
      if (trip && (trip.is_shared || trip.user_id === userId)) {
        trip.rawItinerary = trip.itinerary;
        try { trip.itinerary = JSON.parse(trip.itinerary || '{}'); } catch { trip.itinerary = null; }
        try { trip.highlights = JSON.parse(trip.highlights || '[]'); } catch { trip.highlights = []; }
        tripContext = trip;
      }
      if (!tripContext) return Response.json({ error: 'Không tìm thấy hành trình.' }, { status: 404 });
      if (dayIndex !== undefined && dayIndex >= (tripContext.itinerary?.days?.length || 0)) return Response.json({ error: 'Ngày này không có trong lịch.' }, { status: 400 });
    }

    const messages = [
      ...history.slice(-10).map((m: any) => ({ role: m.role, content: m.content })),
      { role: 'user', content: message },
    ];

    const mutationIntent = /(^|\s)(thêm|bỏ|xóa|xoá|đổi|thay|dời|chuyển|sắp xếp|chỉnh|rút ngắn)(\s|$)/i.test(message);
    let reply: string;
    let proposal = null;
    if (mutationIntent && tripContext && tripContext.user_id === userId) {
      const candidate = deterministicProposal(message, tripContext, db, dayIndex ?? 0) || await customizeTrip(tripContext, message);
      const candidateItinerary = candidate?.days ? { days: candidate.days } : candidate;
      const stateRow = db.prepare('SELECT * FROM trip_state WHERE trip_id = ? AND user_id = ?').get(tripId, userId) as any;
      const state = normalizeTripState(stateRow, tripId, tripContext.itinerary.days);
      const published = db.prepare("SELECT id, name FROM places WHERE publication_status = 'published'").all() as any[];
      const guardError = validateTripChange(tripContext.itinerary, candidateItinerary, state, published);
      if (guardError) return Response.json({ reply: guardError, proposal: null });
      const summary = summarizeChanges(tripContext.itinerary, candidateItinerary);
      if (summary.length) {
        reply = 'Mình đã chuẩn bị một phương án chỉnh lịch. Hãy xem các thay đổi bên dưới và xác nhận trước khi áp dụng.';
        proposal = { instruction: message, itinerary: candidate, summary, expectedItinerary: tripContext.rawItinerary, expectedStateUpdatedAt: stateRow?.updated_at || null };
      } else {
        reply = 'Mình đã hiểu yêu cầu nhưng chưa tạo được thay đổi lịch trình đủ rõ ràng. Bạn hãy nêu cụ thể ngày, địa điểm hoặc thời gian muốn đổi.';
      }
    } else {
      const owned = tripContext && tripContext.user_id === userId;
      const state = owned ? normalizeTripState(db.prepare('SELECT * FROM trip_state WHERE trip_id = ? AND user_id = ?').get(tripId, userId), tripId, tripContext.itinerary?.days || []) : null;
      reply = (tripContext ? progressReply(message, tripContext, state, dayIndex) : null) || groundedPlaceReply(message, db.prepare("SELECT * FROM places WHERE publication_status = 'published'").all() as any[]) || await chat(messages, tripContext);
    }

    if (userId && tripId && tripContext?.user_id === userId) {
      db.prepare('INSERT INTO chat_messages (id, trip_id, user_id, role, content) VALUES (?, ?, ?, ?, ?)').run(uuidv4(), tripId, userId, 'user', message);
      db.prepare('INSERT INTO chat_messages (id, trip_id, user_id, role, content) VALUES (?, ?, ?, ?, ?)').run(uuidv4(), tripId, userId, 'assistant', reply);
    }

    return Response.json({ reply, proposal });
  } catch {
    return Response.json({ error: 'Chưa xử lý được yêu cầu. Lịch trình hiện tại vẫn được giữ; hãy thử lại.' }, { status: 500 });
  }
}
