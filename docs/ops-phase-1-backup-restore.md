# Ops Phase 1: Backup + Restore (PostgreSQL + S3)

Mục tiêu phase này là đảm bảo có bản sao lưu DB, có quy trình restore kiểm chứng được, và có baseline bảo vệ dữ liệu file output trên S3.

## 1) Những gì đã triển khai trong repo

### Script backup PostgreSQL

- File: `scripts/backup-postgres.ps1`
- Chức năng:
  - Tạo dump PostgreSQL định dạng custom (`.dump`) bằng `pg_dump`
  - Sinh checksum SHA-256 (`.sha256`)
  - Sinh metadata (`.json`)
  - Dọn bản backup cũ theo `RetentionDays`
  - Chặn backup nếu major version `pg_dump` khác PostgreSQL server (trừ khi bật `-AllowVersionMismatch`)

Lệnh mẫu:

```powershell
pwsh -File scripts/backup-postgres.ps1 `
  -DatabaseUrl "postgresql://user:pass@host:5432/dbname" `
  -OutputDir "backups/postgres" `
  -RetentionDays 14 `
  -Label "manual"
```

### Script restore PostgreSQL

- File: `scripts/restore-postgres.ps1`
- Chức năng:
  - Restore từ file `.dump` bằng `pg_restore`
  - Dùng `--clean --if-exists` để thay thế object cũ
  - Yêu cầu `-Force` để giảm rủi ro thao tác nhầm
  - Probe `SELECT 1` sau restore
  - Chặn restore nếu major version `pg_restore` khác PostgreSQL server (trừ khi bật `-AllowVersionMismatch`)

Lệnh mẫu:

```powershell
pwsh -File scripts/restore-postgres.ps1 `
  -DatabaseUrl "postgresql://user:pass@host:5432/dbname" `
  -DumpFile "backups/postgres/20260505-120000-db.dump" `
  -Force
```

### Smoke test end-to-end backup/restore

- File: `scripts/smoke-test-backup-restore.ps1`
- Chức năng:
  - Tạo PostgreSQL container tạm
  - Seed dữ liệu mẫu
  - Backup -> mutate dữ liệu -> restore
  - Verify số bản ghi sau restore đúng như ban đầu

Lệnh:

```powershell
pwsh -File scripts/smoke-test-backup-restore.ps1
```

## 2) Cách dùng qua npm scripts

```bash
npm run db:backup
npm run db:restore -- -DumpFile "<path-to-dump>" -Force
npm run db:smoke-backup-restore
```

`db:backup` và `db:restore` mặc định dùng `DATABASE_URL` từ env.

## 3) Ghi chú tương thích version pg tools

Với dump/restore PostgreSQL, nên dùng cùng major version giữa client tools và server DB.  
Ví dụ:

- `pg_dump 17` <-> PostgreSQL `17`
- `pg_dump 15` <-> PostgreSQL `15`

Nếu khác major version, script sẽ dừng sớm để tránh tạo backup/restore rủi ro.

## 4) Quy trình backup/restore đề xuất cho môi trường thật

1. Backup định kỳ:
   - Chạy backup tối thiểu 1 lần/ngày.
   - Giữ tối thiểu 7-14 bản gần nhất.
2. Verify backup:
   - Kiểm tra file `.dump`, `.sha256`, `.json` đều được tạo.
3. Restore drill định kỳ:
   - Ít nhất 1 lần/tháng restore vào DB staging/isolated.
   - Chạy smoke test API cơ bản sau restore (`/health`, truy vấn user/jobs).
4. RTO/RPO:
   - Ghi lại thời gian restore thực tế.
   - Ghi lại điểm backup gần nhất để theo dõi RPO.

## 5) Railway (khuyến nghị vận hành)

1. Bật snapshot/backup tự động trên PostgreSQL service.
2. Duy trì retention theo nhu cầu dữ liệu (7-14 ngày cho MVP là mức cơ bản).
3. Vẫn nên giữ thêm logical dump định kỳ để có phương án restore linh hoạt ngoài snapshot platform.

## 6) S3 dữ liệu output

Phase 1 yêu cầu tối thiểu:

1. Bật **Versioning** cho bucket S3 đang chứa output.
2. Bật **Lifecycle Rules** để kiểm soát chi phí (chuyển lớp lưu trữ hoặc expire version cũ).

Ví dụ AWS CLI:

```bash
aws s3api put-bucket-versioning \
  --bucket <your-bucket> \
  --versioning-configuration Status=Enabled
```

## 7) Bằng chứng test thực tế

Đã chạy local:

1. Smoke test pass với Postgres cùng major version tool:
   - `pwsh -File scripts/smoke-test-backup-restore.ps1`
2. Negative test mismatch pass (script chặn đúng):
   - `pwsh -File scripts/smoke-test-backup-restore.ps1 -PostgresImage postgres:15` khi local `pg_dump` là `17`
3. Build pass:
   - `npm run build`

## 8) Tiêu chí hoàn thành phase

1. Có backup tạo thành công định kỳ.
2. Có restore chạy thành công trên môi trường kiểm thử.
3. Có tài liệu runbook và checklist rõ ràng.
4. Có bằng chứng smoke test backup/restore pass.
