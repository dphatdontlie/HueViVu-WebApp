import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { getAuthUserId } from '@/lib/auth';
import { requireAdmin } from '@/lib/auth';
import { getClientIp, checkRateLimit, rateLimitResponse, RATE_LIMIT_RULES } from '@/lib/rate-limit';

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const userId = getAuthUserId(req) || null;
    const rateKey = userId ? `feedback:user:${userId}` : `feedback:ip:${ip}`;
    const rateCheck = checkRateLimit(rateKey, RATE_LIMIT_RULES.FEEDBACK.limit, RATE_LIMIT_RULES.FEEDBACK.windowMs);
    if (!rateCheck.success) {
      return rateLimitResponse(rateCheck, `Bạn đã gửi phản hồi quá nhiều lần. Vui lòng đợi ${rateCheck.retryAfterSeconds} giây trước khi gửi tiếp.`);
    }

    const db = getDb();
    const { topic, message, email, rating, placeId } = await req.json();
    if (!['bug', 'feature', 'content', 'ai', 'privacy', 'other'].includes(topic) || typeof message !== 'string' || !message.trim() || message.length > 2000 || (email !== undefined && (typeof email !== 'string' || email.length > 254 || (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())))) || (rating !== undefined && (!Number.isInteger(rating) || rating < 0 || rating > 5)) || (placeId != null && (typeof placeId !== 'string' || placeId.length > 80))) {
      return Response.json({ error: 'Hãy chọn chủ đề và nhập nội dung, email hoặc đánh giá hợp lệ.' }, { status: 400 });
    }
    // userId đã được khai báo và kiểm tra ở đầu hàm
    db.prepare(`
      INSERT INTO feedback (id, user_id, topic, message, email, rating, place_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(crypto.randomUUID(), userId, topic, message.trim(), email || null, rating || null, placeId || null);
    if (topic === 'content' && placeId) {
      const place = db.prepare('SELECT name FROM places WHERE id=?').get(placeId) as any;
      if (place) db.prepare(`INSERT INTO data_tasks (id,place_id,task_type,title,description,priority,status,created_by) VALUES (?,?,?,?,?,?,?,?)`).run(crypto.randomUUID(),placeId,'user_feedback',`Kiểm tra phản hồi về ${place.name}`,message.trim(),rating && rating <= 2 ? 'high' : 'medium','open',userId);
    }
    return Response.json({ ok: true });
  } catch (err: any) {
    console.error('[feedback]', err);
    return Response.json({ error: 'Chưa lưu được phản hồi. Hãy thử gửi lại.' }, { status: err instanceof SyntaxError ? 400 : 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const admin = requireAdmin(req);
    if (admin instanceof Response) return admin;
    const db = getDb();
    const rows = db.prepare(`SELECT * FROM feedback ORDER BY created_at DESC`).all();
    return Response.json({ feedback: rows });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
