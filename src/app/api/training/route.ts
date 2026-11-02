import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { logger } from '@/lib/logger';

export async function GET(req: NextRequest) {
  try {
    const admin = requireAdmin(req);
    if (admin instanceof Response) return admin;
    const db = getDb();
    const { searchParams } = new URL(req.url);
    const source = searchParams.get('source');

    let query = 'SELECT * FROM training_examples';
    const params: any[] = [];

    if (source && source !== 'all') {
      query += ' WHERE source = ?';
      params.push(source);
    }
    
    query += ' ORDER BY created_at DESC';

    const examples = db.prepare(query).all(...params);
    return Response.json(examples);
  } catch (error: any) {
    logger.error('Error fetching training examples', { error: error?.message });
    return Response.json({ error: 'Không thể tải dữ liệu huấn luyện do lỗi hệ thống.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const admin = requireAdmin(req);
    if (admin instanceof Response) return admin;
    const db = getDb();
    const data = await req.json();

    const id = crypto.randomUUID();
    const user_profile = data.user_profile || '';
    const context = data.context || '';
    const output = data.output || '';
    const reward = data.reward !== undefined ? parseFloat(data.reward) : 1.0;
    const source = data.source || 'chatbot';
    const image_url = data.image_url || null;

    const stmt = db.prepare(`
      INSERT INTO training_examples (id, user_profile, context, output, reward, source, image_url)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(id, user_profile, context, output, reward, source, image_url);

    return Response.json({ id, message: 'Created successfully' }, { status: 201 });
  } catch (error: any) {
    logger.error('Error creating training example', { error: error?.message });
    return Response.json({ error: 'Không thể tạo dữ liệu huấn luyện do lỗi hệ thống.' }, { status: 500 });
  }
}
