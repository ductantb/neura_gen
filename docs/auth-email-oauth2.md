# Auth Email + Google OAuth2 Integration Guide

Tài liệu này mô tả đúng trạng thái hiện tại của backend auth:

1. Gửi email bằng Gmail SMTP
2. Quên mật khẩu / đặt lại mật khẩu
3. Đăng nhập nhanh bằng Google OAuth2 cho web
4. Đăng nhập bằng Google ID token cho Android/Web SDK

Mục tiêu của tài liệu là giải thích rõ:

1. Đã làm gì
2. Vì sao làm như vậy
3. Cấu hình nào bắt buộc
4. Cách test thực tế

## 1. Kiến trúc auth hiện tại

Hệ thống đang dùng JWT nội bộ (access + refresh) làm chuẩn chung sau khi user xác thực thành công.

Có 3 nhóm luồng:

1. Email/password truyền thống (`register`, `login`, `refresh`, `logout`)
2. Email security flows (`forgot-password`, `reset-password`, `change-password`)
3. Google OAuth2 (`/auth/google` redirect flow và `/auth/google/token` ID token flow)

## 2. Thành phần đã triển khai

## 2.1. Mail service (Gmail SMTP)

File:

1. `src/infra/mail/mail.module.ts`
2. `src/infra/mail/mail.service.ts`

Chức năng:

1. `sendWelcomeEmail(email)`
2. `sendPasswordResetEmail(email, resetToken)`
3. `sendPasswordChangedEmail(email)`

Lý do:

1. Tách module mail riêng để dễ thay SMTP provider sau này.
2. Giảm coupling với `AuthService`.
3. Dễ thêm queue async ở bước mở rộng.

## 2.2. Password reset token storage

Schema:

1. `User.passwordResetTokens`
2. `PasswordResetToken` table

Migration:

1. `prisma/migrations/20260407093000_add_password_reset_tokens/migration.sql`

Lý do:

1. Không lưu token reset dạng plain text.
2. Cho phép token one-time (`usedAt`).
3. Có TTL rõ (`expiresAt`).

## 2.3. Google account linking

Schema:

1. `User.googleId` (nullable + unique)

Migration:

1. `prisma/migrations/20260409091500_add_user_google_id/migration.sql`

Lý do:

1. Tránh tạo user trùng khi user đã có account email/password.
2. Cho phép map ổn định giữa Google account và user nội bộ.

## 2.4. OAuth strategy và guard

File:

1. `src/modules/auth/strategies/google.strategy.ts`
2. `src/modules/auth/guards/google-oauth.guard.ts`

Vai trò:

1. Strategy: xử lý profile Google trong redirect flow.
2. Guard: kiểm tra env bắt buộc và tạo `state` JWT cho redirect flow.

Lý do:

1. Nếu thiếu env thì fail sớm, rõ lỗi.
2. `state` giúp giảm CSRF risk.
3. Tách guard để logic redirect không nằm trong controller.

## 3. API đã có (đúng với code hiện tại)

## 3.1. Email/password

1. `POST /auth/register`
2. `POST /auth/login`
3. `POST /auth/refresh`
4. `POST /auth/logout`
5. `POST /auth/logout-all`
6. `PATCH /auth/change-password`

## 3.2. Password reset

1. `POST /auth/forgot-password`
2. `POST /auth/reset-password`

## 3.3. Google OAuth2

1. `GET /auth/google`
2. `GET /auth/google/callback`
3. `POST /auth/google/exchange-code`
4. `POST /auth/google/token`

## 4. Luồng chi tiết và lý do thiết kế

## 4.1. `POST /auth/forgot-password`

Flow:

1. Nhận email
2. Tìm user theo email
3. Nếu không tồn tại vẫn trả message chung
4. Nếu tồn tại: tạo reset token random
5. Hash SHA-256 token và lưu DB
6. Xóa token cũ của user
7. Gửi email reset link

Lý do:

1. Message chung để tránh lộ email có tồn tại hay không.
2. Hash token để giảm impact khi lộ DB.
3. Chỉ giữ 1 token active mỗi user để đơn giản hóa kiểm soát.

## 4.2. `POST /auth/reset-password`

Flow:

1. Nhận `token` + `newPassword`
2. Hash token để tìm bản ghi
3. Validate: tồn tại, chưa dùng, chưa hết hạn
4. Đổi mật khẩu user
5. Revoke toàn bộ refresh sessions
6. Mark token `usedAt`
7. Gửi email cảnh báo đổi mật khẩu

Lý do:

1. Session cũ phải bị vô hiệu sau reset.
2. One-time token chống replay.
3. Email cảnh báo tăng khả năng phát hiện truy cập trái phép.

## 4.3. `PATCH /auth/change-password`

Flow:

1. Verify `oldPassword`
2. Update password mới
3. Revoke refresh sessions
4. Xóa reset tokens cũ
5. Gửi email thông báo

Lý do:

1. Đồng nhất bảo mật với reset flow.
2. Tránh giữ session cũ sau đổi mật khẩu.

## 4.4. Web redirect flow (`GET /auth/google` -> callback -> exchange)

Flow:

1. FE gọi `/auth/google?redirectUri=<allowed>&platform=web`
2. Guard tạo `state` JWT (kèm nonce, redirectUri, platform)
3. Redirect tới Google consent
4. Google callback vào `/auth/google/callback`
5. Backend login/link user Google
6. Backend tạo `one-time auth code` (lưu Redis, TTL ngắn)
7. Redirect về `redirectUri?code=...`
8. FE gọi `POST /auth/google/exchange-code`
9. Backend đổi code lấy `accessToken` + `refreshToken`

Lý do:

1. Không trả JWT trực tiếp trong browser callback URL.
2. `state` giúp giảm CSRF và giữ context redirect.
3. One-time code giảm replay risk.

## 4.5. ID token flow (`POST /auth/google/token`) cho Android/Web SDK

Flow:

1. Client SDK lấy `idToken` từ Google
2. Gửi `idToken` lên backend
3. Backend verify bằng `google-auth-library` + audience allowlist
4. Backend login/link user
5. Trả JWT nội bộ

Lý do:

1. Android không cần phụ thuộc browser callback flow.
2. Web One Tap/GIS có thể dùng cùng endpoint.
3. Dùng chung backend account-linking logic.

## 5. Env bắt buộc

```env
# Gmail SMTP
MAIL_HOST=smtp.gmail.com
MAIL_PORT=587
MAIL_SECURE=false
MAIL_ENABLED=true
MAIL_USER=your_gmail_address
MAIL_APP_PASSWORD=your_gmail_app_password
MAIL_FROM="Neura Gen <your_gmail_address>"
FRONTEND_URL=http://localhost:5173
PASSWORD_RESET_TOKEN_TTL_MINUTES=15

# Google OAuth2
GOOGLE_CLIENT_ID=your_web_client_id
GOOGLE_CLIENT_SECRET=your_web_client_secret
GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback
GOOGLE_ALLOWED_AUDIENCES=web_client_id,android_debug_client_id,android_release_client_id
OAUTH_STATE_SECRET=replace_with_strong_random_secret
OAUTH_STATE_EXPIRES_IN=10m
GOOGLE_AUTH_CODE_TTL_SECONDS=120
OAUTH_ALLOWED_REDIRECT_URIS=http://localhost:5173/auth/callback,neuragen://auth/callback
```

Ghi chú:

1. `GOOGLE_CLIENT_ID` nên là web client ID.
2. `GOOGLE_ALLOWED_AUDIENCES` phải chứa đủ client IDs thực tế dùng để phát `idToken`.
3. `OAUTH_ALLOWED_REDIRECT_URIS` chỉ nên chứa redirect URI tin cậy.

## 6. Android OAuth client và SHA

Đối với Android, cần tạo riêng:

1. Android client debug (package + SHA-1 debug)
2. Android client release (package + SHA-1 release)

Lý do:

1. Debug và release thường khác certificate fingerprint.
2. Tránh lỗi login khi đổi từ local debug sang bản release.

## 7. Test checklist khuyến nghị

## 7.1. Backend validation

1. `npm run build`
2. `npx jest src/modules/auth --runInBand`

## 7.2. API runtime checks

1. `/auth/google` phải trả 302 tới Google OAuth URL
2. `/auth/google/token` token giả -> 401
3. `/auth/google/exchange-code` code giả -> 401
4. `/auth/forgot-password` trả message chung

## 7.3. Full client E2E

Web:

1. Call `/auth/google?redirectUri=...`
2. Login Google
3. FE nhận `code`
4. FE call `/auth/google/exchange-code`
5. Nhận `accessToken` + `refreshToken`

Android:

1. SDK lấy `idToken`
2. Call `/auth/google/token`
3. Nhận `accessToken` + `refreshToken`

## 8. Rủi ro và lưu ý vận hành

1. Không commit secret thật lên repo (`.env`, keystore, app password).
2. Rotate secret nếu từng lộ.
3. Theo dõi tỷ lệ lỗi callback/token verify.
4. Nếu lưu lượng mail lớn, nên chuyển gửi mail qua queue.

## 9. Hướng mở rộng tiếp theo

1. Thêm rate limit cho `/auth/forgot-password` và OAuth endpoints.
2. Thêm audit log cho login bất thường / đổi mật khẩu.
3. Thêm email verification flow cho user mới.
4. Thêm integration test OAuth bằng môi trường test account riêng.
Ghi chu:

- Neu chua co SMTP hop le o local/dev, dat `MAIL_ENABLED=false` de tat luong gui mail.
- Neu dung Gmail:
  - can bat 2FA
  - can tao App Password rieng
  - backend hien tu dong loai bo khoang trang trong `MAIL_APP_PASSWORD`
