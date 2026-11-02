# HueViVu — Kế hoạch Xử lý Bảo mật & Tồn đọng (Security Remediation Plan)

Tài liệu kế hoạch chi tiết giải quyết toàn bộ các phát hiện kiểm toán bảo mật và nợ kỹ thuật trong [task.html](file:///d:/HueViVu-WebApp/task.html), tuân thủ nghiêm ngặt quy tắc **Production-Safe Coding** ([GEMINI.md](file:///c:/Users/kngye/.gemini/GEMINI.md)) và **Quy trình kiểm chứng runtime** ([AGENTS.md](file:///d:/HueViVu-WebApp/AGENTS.md)).

---

## 🎯 Mục tiêu
1. **Triệt tiêu lỗi Blocker P0**: Khởi tạo database sạch không bị crash `/api/health` 503 (`ACT-A01`).
2. **Khóa chặt lỗ hổng Brute-force & Spam**: Cài đặt Rate Limiting cho Auth, Feedback, AI Chat (`SEC-01` / `ACT-A02`).
3. **Che giấu lỗi hệ thống**: Loại bỏ rò rỉ `err.message` / SQL query ra client ở các endpoint 500 (`SEC-02` / `ACT-A03`).
4. **Loại bỏ rủi ro cào lậu TTS**: Chuyển hướng sang Web Speech API trên trình duyệt (`SEC-03` / `ACT-A04`).
5. **Bảo toàn 100% chức năng hiện có**: 28/28 smoke test tự động giữ vững PASS, không xóa code cũ, diff tối thiểu.

---

## 📋 Danh sách công việc theo 5 Phase

### Phase 1: Blocker P0 & Cấu hình Môi trường
- [ ] **Task 1.1 (ACT-A01 / Blocker P0)**: Sửa lỗi khởi tạo DB sạch trong [src/lib/db.ts](file:///d:/HueViVu-WebApp/src/lib/db.ts).
  - *Mô tả*: Khi bảng `places` rỗng, tự động nạp danh sách fixture địa điểm di sản chuẩn của Huế (Đại Nội, Thiên Mụ, Khải Định, Tự Đức, Đông Ba...).
  - *Nghiệm thu*: Endpoint `/api/health` trả về HTTP 200 `{ status: "ok" }` ngay cả trên database mới tinh.
- [ ] **Task 1.2 (SEC-04 / Config)**: Cấu hình `JWT_SECRET` trong [.env.local](file:///d:/HueViVu-WebApp/.env.local).
  - *Mô tả*: Sinh chuỗi ngẫu nhiên cryptographically secure (64 ký tự hex) cho `JWT_SECRET`.
  - *Nghiệm thu*: Chạy `node scripts/check-production-env.cjs` đạt **PASS production environment basics**.

---

### Phase 2: Triển khai Rate Limiting (SEC-01 / ACT-A02)
- [ ] **Task 2.1**: Xây dựng module Rate Limiter cốt lõi tại `src/lib/rate-limit.ts`.
  - *Thuật toán*: Sliding Window Counter In-Memory có interval dọn dẹp bộ nhớ mỗi 60s (chống memory leak).
  - *Headers chuẩn RFC*: `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.
  - *Sẵn sàng adapter*: Tự động kết nối Redis nếu biến `process.env.REDIS_URL` được cấu hình.
- [ ] **Task 2.2**: Áp dụng Rate Limit cho Login (`/api/auth/login`).
  - *Giới hạn*: 5 requests / 1 phút / IP. Trả HTTP 429 khi vượt ngưỡng.
- [ ] **Task 2.3**: Áp dụng Rate Limit cho Register (`/api/auth/register`).
  - *Giới hạn*: 3 requests / 1 phút / IP (chống bot spam tài khoản).
- [ ] **Task 2.4**: Áp dụng Rate Limit cho Feedback (`/api/feedback` POST).
  - *Giới hạn*: 3 requests / 1 phút / IP+User (chống spam DB và rác hàng đợi `data_tasks`).
- [ ] **Task 2.5**: Áp dụng Rate Limit cho AI Chat (`/api/chat` POST).
  - *Giới hạn*: 10 requests / 1 phút / User (bảo vệ hạn mức quota token Gemini AI).
- [ ] **Task 2.6**: Viết kịch bản kiểm thử tự động `scripts/test-rate-limiting.mjs`.
  - *Nghiệm thu*: Gửi liên tiếp các request vượt ngưỡng, xác nhận server trả đúng HTTP 429 và mở lại sau khi hết thời gian window.

---

### Phase 3: Chuẩn hóa Lỗi HTTP 500 & Che giấu Stack Trace (SEC-02 / ACT-A03)
- [ ] **Task 3.1**: Chuẩn hóa thông báo lỗi ở tất cả các API route có nguy cơ rò rỉ `err.message` / `error.message`.
  - *Danh sách route*:
    1. [src/app/api/auth/login/route.ts](file:///d:/HueViVu-WebApp/src/app/api/auth/login/route.ts)
    2. [src/app/api/auth/register/route.ts](file:///d:/HueViVu-WebApp/src/app/api/auth/register/route.ts)
    3. [src/app/api/feedback/route.ts](file:///d:/HueViVu-WebApp/src/app/api/feedback/route.ts)
    4. [src/app/api/events/route.ts](file:///d:/HueViVu-WebApp/src/app/api/events/route.ts)
    5. [src/app/api/places/route.ts](file:///d:/HueViVu-WebApp/src/app/api/places/route.ts) & `[id]/route.ts`
    6. [src/app/api/tours/route.ts](file:///d:/HueViVu-WebApp/src/app/api/tours/route.ts) & `[id]/route.ts`
    7. [src/app/api/trips/[id]/add-place/route.ts](file:///d:/HueViVu-WebApp/src/app/api/trips/[id]/add-place/route.ts)
    8. [src/app/api/trips/[id]/adapt/route.ts](file:///d:/HueViVu-WebApp/src/app/api/trips/[id]/adapt/route.ts)
    9. [src/app/api/training/route.ts](file:///d:/HueViVu-WebApp/src/app/api/training/route.ts) & `[id]/route.ts`
    10. [src/app/api/vision/route.ts](file:///d:/HueViVu-WebApp/src/app/api/vision/route.ts)
  - *Quy tắc xử lý*:
    - Ghi log chi tiết nội bộ qua `logger.error(..., { error: err.message, requestId })`.
    - Phản hồi client câu thông báo chung tiếng Việt thân thiện, che giấu hoàn toàn SQL/stack trace.

---

### Phase 4: Chuyển đổi TTS An toàn (SEC-03 / ACT-A04)
- [ ] **Task 4.1**: Tạo helper/hook Web Speech API phía Client (`src/lib/speech.ts`).
  - *Mô tả*: Sử dụng trực tiếp `window.speechSynthesis` hỗ trợ giọng đọc tiếng Việt (`vi-VN`) trên trình duyệt, không tốn tài nguyên server.
- [ ] **Task 4.2**: Cập nhật endpoint `/api/tts/route.ts`.
  - *Mô tả*: Đánh dấu deprecated, bổ sung Rate Limit nghiêm ngặt (5 req/phút) và che giấu lỗi 500, giữ nguyên làm fallback an toàn thay vì xóa.

---

### Phase 5: Kiểm thử Tổng thể & Cập nhật Trạng thái
- [ ] **Task 5.1**: Chạy `npm run test:types` (TypeScript không có bất kỳ compile error nào).
- [ ] **Task 5.2**: Chạy `npm run test:smoke` (Đảm bảo trọn vẹn 28/28 ca kiểm thử tự động đạt PASS).
- [ ] **Task 5.3**: Chạy app dev server `npm run dev`, mở trình duyệt kiểm tra visual UI & test thử nghiệm thực tế.
- [ ] **Task 5.4**: Cập nhật báo cáo nghiệm thu vào [task.html](file:///d:/HueViVu-WebApp/task.html) và [docs/PRODUCTION_TRACKER.html](file:///d:/HueViVu-WebApp/docs/PRODUCTION_TRACKER.html).

---

## 🔒 Cam kết An toàn (Production-Safe Protocol)
1. **Không xóa code cũ**: Giữ nguyên hoặc để dạng comment đánh dấu rõ ràng.
2. **Diff tối thiểu**: Sửa đúng mục tiêu của từng task, không refactor lan man.
3. **Báo cáo sau mỗi bước**: Nêu rõ *Đã sửa*, *Không đụng vào*, *Cách kiểm tra* và *Rủi ro*.
