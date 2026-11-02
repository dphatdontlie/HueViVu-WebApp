import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { logger } from '@/lib/logger';

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  try {
    const admin = requireAdmin(req);
    if (admin instanceof Response) return admin;
    const db = getDb();
    const example = db.prepare('SELECT * FROM training_examples WHERE id = ?').get(params.id);
    if (!example) return Response.json({ error: 'Not found' }, { status: 404 });
    return Response.json(example);
  } catch (error: any) {
    logger.error('Error getting training example', { error: error?.message, id: params.id });
    return Response.json({ error: 'Không thể tải dữ liệu huấn luyện do lỗi hệ thống.' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  try {
    const admin = requireAdmin(req);
    if (admin instanceof Response) return admin;
    const db = getDb();
    const data = await req.json();

    const user_profile = data.user_profile || '';
    const context = data.context || '';
    const output = data.output || '';
    const reward = data.reward !== undefined ? parseFloat(data.reward) : 1.0;
    const source = data.source || 'chatbot';
    const image_url = data.image_url || null;

    const stmt = db.prepare(`
      UPDATE training_examples 
      SET user_profile = ?, context = ?, output = ?, reward = ?, source = ?, image_url = ?
      WHERE id = ?
    `);

    stmt.run(user_profile, context, output, reward, source, image_url, params.id);

    return Response.json({ message: 'Updated successfully' });
  } catch (error: any) {
    logger.error('Error updating training example', { error: error?.message, id: params.id });
    return Response.json({ error: 'Không thể cập nhật dữ liệu huấn luyện do lỗi hệ thống.' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  try {
    const admin = requireAdmin(req);
    if (admin instanceof Response) return admin;
    const db = getDb();
    db.prepare('DELETE FROM training_examples WHERE id = ?').run(params.id);
    return Response.json({ message: 'Deleted successfully' });
  } catch (error: any) {
    logger.error('Error deleting training example', { error: error?.message, id: params.id });
    return Response.json({ error: 'Không thể xóa dữ liệu huấn luyện do lỗi hệ thống.' }, { status: 500 });
  }
}
