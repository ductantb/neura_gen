# Explore Feed MVP (UGC + Auto Ranking)

Tài liệu này mô tả cơ chế Explore hiện tại trong backend:

- Nội dung do user đăng (`post.isPublic = true`)
- Hệ thống tự đồng bộ vào bảng `ExploreItem`
- Hệ thống tự chấm điểm và xếp hạng
- Có xử lý cold-start để bài mới không bị chìm ngay

## 1. Mục tiêu

MVP Explore tập trung vào 3 mục tiêu chính:

1. Không cần admin chọn bài thủ công từng item.
2. Bài public lên feed nhanh, phản ánh tương tác gần thời gian thực.
3. Bài mới có cơ hội xuất hiện dù chưa có nhiều tương tác.

## 2. Triết lý vận hành

Explore trong MVP là mô hình **UGC + thuật toán**:

- User đăng post public.
- Hệ thống tính `score` dựa trên like/comment/view + độ mới + quality rate.
- Feed render theo mode (`trending`, `new`, `top`).
- Admin (nếu có) chủ yếu dùng cho kiểm duyệt hoặc override, không curate tay từng bài.

## 3. Endpoint hiện tại

### 3.1 Explore feed (public)

- `GET /explore`
- Không cần access token.

Query params:

- `mode`: `trending | new | top` (mặc định `trending`)
- `topic`: lọc theo topic
- `trending`: `true|false` (tùy chọn; nếu không truyền và mode là `trending` thì mặc định chỉ lấy bài trending)
- `sort`: `score | newest` (giữ tương thích API cũ)
- `limit`: `1..50` (mặc định `20`)
- `cursor`: cursor pagination theo `ExploreItem.id`

Response shape:

```json
{
  "mode": "trending",
  "data": [
    {
      "id": "explore-item-id",
      "title": "My video",
      "topic": "anime",
      "score": 18.24,
      "isTrending": true,
      "createdAt": "2026-04-05T10:00:00.000Z",
      "post": {
        "id": "post-id",
        "caption": "A #anime cyberpunk scene",
        "user": {
          "id": "user-id",
          "username": "demo",
          "avatarUrl": null
        }
      }
    }
  ],
  "nextCursor": "next-explore-item-id-or-null",
  "limit": 20
}
```

### 3.2 Posts list/detail (public)

Để frontend Explore mở xem nội dung thuận tiện, các endpoint sau đã public:

- `GET /posts`
- `GET /posts/:id`

## 4. Luồng đồng bộ dữ liệu vào Explore

### 4.1 Đồng bộ ngay theo event

Hệ thống gọi `syncPost(postId)` ngay khi có thay đổi chính:

- Tạo post
- Cập nhật post (đặc biệt `isPublic`, caption, assetVersionId)
- Like post
- Unlike post
- Tạo comment
- Xóa comment

Nếu post chuyển sang private (`isPublic = false`) thì item Explore bị gỡ khỏi feed.

### 4.2 Đồng bộ định kỳ

Có cron mỗi 10 phút để:

- Recompute score toàn bộ post public
- Làm sạch item Explore của post private

Mục đích:

- Chống lệch điểm theo thời gian
- Đồng bộ lại trạng thái nếu có event bị missed

## 5. Công thức chấm điểm hiện tại

Score được tính theo:

```text
engagementScore = likes * 3 + comments * 4 + ln(1 + views) * 2
qualityRate     = (likes + comments * 2) / max(views, 20)
qualityBoost    = min(8, qualityRate * 40)
freshnessBoost  = max(0, 24 - ageHours) * 0.35
coldStartBoost  = 10 (<=2h), 6 (<=12h), 3 (<=24h), 0 (>24h)
decay           = ageHours * 0.15

score = max(0, engagementScore + qualityBoost + freshnessBoost + coldStartBoost - decay)
```

Trong đó:

- `ageHours` = số giờ kể từ lúc post được tạo.
- `views` dùng `log1p` để tránh bài view quá cao nuốt hết feed.
- `max(views, 20)` để tránh quality rate bị ảo khi view còn quá thấp.

## 6. Cách xử lý cold-start (bài mới chưa có tương tác)

Đây là phần trả lời trực tiếp câu hỏi bạn đã nêu:

1. Có **mục riêng cho bài mới**: `mode=new`
2. Có **coldStartBoost theo thời gian đầu**:
   - 0-2h: +10
   - 2-12h: +6
   - 12-24h: +3
   - >24h: +0
3. Có `freshnessBoost` để bài mới vẫn được ưu tiên nhẹ.

Kết quả:

- Bài mới không bị chết ngay vì chưa đủ like/comment.
- Sau 24h, bài phải sống bằng chất lượng tương tác thật.

## 7. Quy tắc trending hiện tại

`isTrending = true` khi:

- Tuổi bài `<= 72 giờ`
- `score >= 14`

Lưu ý:

- Đây là ngưỡng MVP, nên tune theo dữ liệu thực tế.

## 8. Suy luận topic/title tự động

Khi sync vào Explore:

- `title`: cắt từ caption (tối đa 100 ký tự), rỗng thì `"Untitled creation"`.
- `topic`:
  - Ưu tiên hashtag đầu tiên trong caption (ví dụ `#anime`)
  - Nếu không có hashtag thì map keyword đơn giản:
    - `anime|manga|otaku` -> `anime`
    - `cinematic|movie|film` -> `cinematic`
    - `portrait|face|selfie` -> `portrait`
    - `landscape|nature|forest|mountain` -> `landscape`
    - `scifi|sci-fi|cyberpunk|future` -> `scifi`
  - Không match thì `general`

## 9. Hành vi mode và sort

### 9.1 Mode

- `mode=trending`: mặc định ưu tiên item `isTrending=true`.
- `mode=new`: ưu tiên mới nhất (`createdAt desc`).
- `mode=top`: ưu tiên điểm cao (`score desc`).

### 9.2 Sort (compat)

`sort` vẫn hoạt động để tương thích client cũ:

- `sort=newest` -> ép về behavior như `mode=new`
- `sort=score` -> behavior như `mode=top` (trừ khi mode đã là `new`)

## 10. Ví dụ test nhanh

### 10.1 Lấy feed trending

```bash
curl "http://localhost:3000/explore?mode=trending&limit=20"
```

### 10.2 Lấy feed bài mới

```bash
curl "http://localhost:3000/explore?mode=new&limit=20"
```

### 10.3 Lấy feed điểm cao theo topic

```bash
curl "http://localhost:3000/explore?mode=top&topic=anime&limit=20"
```

## 11. Giới hạn hiện tại (MVP)

1. Chưa có personalization `for_you` theo hành vi user.
2. Chưa có event `share/save/watch_time` để chấm điểm sâu hơn.
3. Chưa có moderation pipeline tự động (NSFW/spam classifier).
4. ViewCount được flush theo chu kỳ, nên độ trễ điểm theo view là chấp nhận được ở mức MVP.

## 12. Gợi ý nâng cấp phase tiếp theo

1. Thêm mode `for_you` theo embedding/topic affinity.
2. Bổ sung `saveCount`, `shareCount`, `watchTimeMs` vào công thức.
3. Tách score thành 2 tầng:
   - `qualityScore` (dài hạn)
   - `velocityScore` (ngắn hạn)
4. Thêm admin tools:
   - force hide
   - force pin
   - review queue

## 13. Checklist vận hành

1. Đảm bảo scheduler đang chạy (`ScheduleModule`).
2. Đảm bảo event like/comment/post update gọi được `syncPost`.
3. Theo dõi phân bố score theo ngày để tune ngưỡng trending.
4. Quan sát tỷ lệ bài mới xuất hiện ở `mode=trending` và `mode=new`.

