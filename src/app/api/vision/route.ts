import { NextRequest } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getDb } from '@/lib/db';
import { parsePlaceRow } from '@/lib/place-data';
import { logger } from '@/lib/logger';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'MISSING_API_KEY');

function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const rad = (value: number) => value * Math.PI / 180;
  const dLat = rad(lat2 - lat1); const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function nearbyPlaces(lat?: number, lng?: number) {
  const db = getDb();
  const rows = db.prepare(`SELECT * FROM places
    WHERE publication_status = 'published' AND lat IS NOT NULL AND lng IS NOT NULL
    ORDER BY CASE verification_status WHEN 'verified' THEN 0 WHEN 'reviewed' THEN 1 ELSE 2 END, popularity DESC
    LIMIT 80`).all() as any[];
  const parsed: any[] = rows.map(parsePlaceRow);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return parsed.slice(0, 5);
  return parsed.map(place => ({ ...place, distance_km: distanceKm(lat!, lng!, Number(place.lat), Number(place.lng)) }))
    .sort((a, b) => a.distance_km - b.distance_km).slice(0, 5);
}

function fallbackReply(mode: string, places: any[], prompt: string) {
  const place = places[0];
  if (!place) return 'Mình chưa có dữ liệu đã kiểm chứng đủ gần vị trí này. Bạn có thể chụp rõ bảng tên hoặc mô tả điều đang nhìn thấy.';
  if (mode === 'practical') return `${place.name}: ${place.hours || 'giờ mở cửa chưa được xác minh'}; ${place.price || 'giá chưa cập nhật'}. ${place.tips?.[0] || place.ai_insight || 'Hãy kiểm tra thông tin tại quầy trước khi vào.'}`;
  if (mode === 'next') return `Điểm phù hợp gần bạn là ${place.name}${place.distance_km != null ? `, cách khoảng ${place.distance_km.toFixed(1)} km` : ''}. ${place.ai_insight || place.description || ''}`;
  if (mode === 'story') return `${place.name}. ${place.description || place.ai_insight || 'Dữ liệu kể chuyện đang được người kiểm chứng bổ sung.'}`;
  return `Địa điểm tham khảo trong danh mục: ${place.name}. ${place.ai_insight || place.description || `Câu hỏi của bạn: ${prompt}`}`;
}

export async function POST(req: NextRequest) {
  try {
    const { image, prompt = 'Đây là gì?', mode = 'identify', lat, lng, weather, tripContext } = await req.json();
    if (!image) return Response.json({ error: 'Thiếu hình ảnh từ camera' }, { status: 400 });

    const places = nearbyPlaces(Number(lat), Number(lng));
    const publicPlaces = places.map(place => ({
      id: place.id, name: place.name, category: place.category, address: place.address,
      distance_km: place.distance_km, hours: place.hours, price: place.price,
      verified: place.verification_status === 'verified',
    }));
    const suggestions = ['Đây là công trình gì?', 'Kể tôi một câu chuyện ngắn', 'Có mẹo tham quan nào?', 'Tiếp theo nên đi đâu?'];

    if (!process.env.GEMINI_API_KEY) {
      return Response.json({ reply: `Nhận diện ảnh hiện chưa sẵn sàng; gợi ý sau lấy từ danh mục địa điểm, chưa xác định được nội dung ảnh. ${fallbackReply(mode, places, prompt)}${places.some(place => place.verification_status !== 'verified') ? ' Giá, giờ và nội dung cần được xác nhận với địa điểm trước khi đi.' : ''}`, nearby: publicPlaces, suggestions, source: 'catalog-fallback' });
    }

    const knowledge = places.map((place, index) => {
      const verified = place.verification_status === 'verified' ? 'ĐÃ XÁC MINH' : 'CHƯA XÁC MINH ĐỦ';
      return `${index + 1}. ${place.name} [${verified}]${place.distance_km != null ? ` — ${place.distance_km.toFixed(2)} km` : ''}\nĐịa chỉ: ${place.address || 'chưa có'}\nGiờ: ${place.hours || place.hours_time || 'chưa xác minh'}\nGiá: ${place.price || 'chưa xác minh'}\nMô tả: ${place.description || ''}\nInsight: ${place.ai_insight || ''}\nMẹo: ${(place.tips || []).join('; ')}`;
    }).join('\n\n');

    const modeInstruction: Record<string, string> = {
      identify: 'Nhận diện thứ nổi bật trong ảnh. Nếu không chắc, nói rõ mức độ chắc chắn và hỏi người dùng chụp bảng tên.',
      story: 'Kể một câu chuyện lịch sử-văn hóa hấp dẫn trong 80-120 từ, chỉ dùng sự kiện chắc chắn.',
      practical: 'Ưu tiên giờ mở cửa, giá, lối vào, trang phục, thời tiết và mẹo thực tế.',
      next: 'Đề xuất bước tiếp theo dựa trên vị trí, thời tiết và hành trình hiện tại.',
    };
    const systemInstruction = `Bạn là HueViVu Live Guide, hướng dẫn viên Huế tại chỗ.
${modeInstruction[mode] || modeInstruction.identify}
Chỉ khẳng định dữ kiện có trong DỮ LIỆU ĐÃ KIỂM CHỨNG bên dưới hoặc nhìn thấy rõ trong ảnh. Không bịa tên công trình, niên đại, giá hay giờ mở cửa. Nếu dữ liệu chưa xác minh, nói thẳng. Trả lời tiếng Việt tự nhiên, tối đa 130 từ, mở đầu bằng kết luận hữu ích nhất.

Vị trí/thời tiết: ${weather || 'chưa có'}
Hành trình hiện tại: ${tripContext || 'chưa có'}

DỮ LIỆU GẦN NGƯỜI DÙNG:
${knowledge || 'Chưa có địa điểm gần vị trí này.'}`;

    const base64Data = String(image).split(',')[1] || image;
    const model = genAI.getGenerativeModel({ model: process.env.GEMINI_VISION_MODEL || 'gemini-2.0-flash' });
    const result = await model.generateContent([
      systemInstruction,
      `Câu hỏi của khách: ${prompt}`,
      { inlineData: { data: base64Data, mimeType: 'image/jpeg' } },
    ]);
    return Response.json({ reply: result.response.text(), nearby: publicPlaces, suggestions, source: 'vision-grounded' });
  } catch (error: any) {
    logger.error('Vision API error', { error: error?.message });
    return Response.json({ error: 'Live Guide tạm thời chưa xử lý được ảnh do lỗi hệ thống. Vui lòng thử lại sau.' }, { status: 500 });
  }
}
