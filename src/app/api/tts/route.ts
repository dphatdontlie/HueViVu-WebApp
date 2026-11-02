import { NextRequest } from 'next/server';
import { logger } from '@/lib/logger';

export async function GET(req: NextRequest) {
  try {
    const text = req.nextUrl.searchParams.get('text');
    if (!text) {
      return new Response('Missing text', { status: 400 });
    }
    if (text.length > 200) return new Response('Text too long', { status: 400 });

    const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=vi&client=tw-ob`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Referer': 'https://translate.google.com/'
      }
    });

    if (!response.ok) {
      return new Response('TTS API Error', { status: response.status });
    }

    const buffer = await response.arrayBuffer();
    
    return new Response(buffer, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'public, max-age=3600'
      }
    });
  } catch (err: any) {
    logger.error('TTS synthesis error', { error: err?.message });
    return new Response('Không thể tạo âm thanh do lỗi hệ thống.', { status: 500 });
  }
}
