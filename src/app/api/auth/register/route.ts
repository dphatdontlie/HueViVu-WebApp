import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { generateToken } from '@/lib/auth';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { getClientIp, checkRateLimit, rateLimitResponse, RATE_LIMIT_RULES } from '@/lib/rate-limit';

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const rateCheck = checkRateLimit(`register:${ip}`, RATE_LIMIT_RULES.AUTH_REGISTER.limit, RATE_LIMIT_RULES.AUTH_REGISTER.windowMs);
    if (!rateCheck.success) {
      return rateLimitResponse(rateCheck, `Bạn đã tạo tài khoản quá nhiều lần. Vui lòng thử lại sau ${rateCheck.retryAfterSeconds} giây.`);
    }

    const { name, email, password } = await req.json();
    if (typeof name !== 'string' || typeof email !== 'string' || typeof password !== 'string' || !name || !email || !password || name.length > 100 || email.length > 254 || password.length > 256) return Response.json({ error: 'Hãy nhập tên, email và mật khẩu hợp lệ.' }, { status: 400 });
    const normalizedEmail = String(email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) return Response.json({ error: 'Email không hợp lệ' }, { status: 400 });
    if (String(password).length < 6) return Response.json({ error: 'Mật khẩu cần ít nhất 6 ký tự' }, { status: 400 });
    if (String(name).trim().length < 2) return Response.json({ error: 'Tên cần ít nhất 2 ký tự' }, { status: 400 });

    const db = getDb();
    if (db.prepare('SELECT id FROM users WHERE lower(email) = ?').get(normalizedEmail)) {
      return Response.json({ error: 'Email đã được sử dụng' }, { status: 409 });
    }

    const id = 'user_' + uuidv4().replace(/-/g, '').slice(0, 12);
    const hash = await bcrypt.hash(password, 10);
    db.prepare('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)').run(id, String(name).trim(), normalizedEmail, hash);

    const user = db.prepare('SELECT id, name, email, level, total_trips FROM users WHERE id = ?').get(id);
    return Response.json({ token: generateToken(id), user });
  } catch (err: any) {
    return Response.json({ error: 'Lỗi đăng ký: ' + err.message }, { status: 500 });
  }
}
