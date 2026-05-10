# Deploy Railway - Implementation Notes

Tai lieu nay tong hop chi tiet dot deploy backend len Railway cho `neura-gen`: da lam gi, thay doi gi trong code/config, vi sao lam nhu vay, va cach van hanh sau deploy.

## 1) Muc tieu dot deploy

- Dua backend production len domain public: `https://api.neuragen.xyz`
- Tach rieng process `api` va `worker` de queue xu ly on dinh
- Chay cung stack quan ly boi Railway: `Postgres` + `Redis`
- Chuan hoa quy trinh deploy de co the lap lai an toan cho cac lan sau

## 2) Kien truc production duoc chot

- `api`: NestJS service nhan request tu client, expose Swagger + health
- `worker`: process BullMQ xu ly job nen
- `Postgres`: database managed tren Railway
- `Redis`: queue + cache managed tren Railway

Ly do:

- Tach `api`/`worker` tranh nghen request user khi job video nang.
- Dung DB/Redis managed giam effort van hanh, phu hop giai doan MVP.

## 3) Thay doi trong code va scripts

### 3.1 Runtime scripts cho production

Da cap nhat scripts trong `package.json`:

- `start` chay `node dist/src/main.js` (thay vi chay dev mode)
- them `prebuild=prisma generate` de build co Prisma client dung
- them `migrate:deploy` de chay migration production de dang
- them bo scripts ho tro deploy/check env:
  - `env:check:prod`
  - `railway:sync:api`
  - `railway:sync:worker`
  - `railway:deploy`

Ly do:

- Railway can entrypoint production ro rang.
- Tranh loi runtime do thieu Prisma client.
- Giam thao tac tay va giam risk sai env khi deploy.

### 3.2 Healthcheck production

Da bo sung endpoint `GET /health` public va skip throttle, check readiness tu `OpsService`:

- verify ket noi `database`
- verify ket noi `redis`

Ly do:

- Healthcheck cua platform can endpoint nhe, phan hoi nhanh.
- Readiness check dung de phat hien service song nhung dependency chet.

### 3.3 Redis compatibility cho Railway

Da cap nhat khoi tao Redis de ho tro nhieu format env:

- uu tien `REDIS_URL`
- fallback `REDIS_HOST`/`REDIS_PORT`
- ho tro them bien Railway (`REDISHOST`, `REDISPORT`, `REDISUSER`, `REDISPASSWORD`)

Ly do:

- Railway inject env theo mau rieng cho Redis service.
- Khong phu thuoc mot kieu env duy nhat, de chay local va production cung code.

### 3.4 Scripts tu dong hoa deploy Railway

Da them 3 script PowerShell:

- `scripts/check-production-env.ps1`
  - kiem tra key bat buoc
  - canh bao bien con `localhost`
- `scripts/railway-sync-env.ps1`
  - sync `.env` len tung service
  - bo qua key rong (tranh fail do stdin empty)
- `scripts/railway-deploy.ps1`
  - sync env cho `api`/`worker`
  - set `RUN_WORKER` dung role
  - trigger deploy hai service

Ly do:

- Dot deploy ban dau gap nhieu diem de sai do thao tac tay env.
- Script hoa de tao quy trinh co the lap lai, de onboarding team nhanh hon.

## 4) Cac buoc deploy thuc te da thuc hien

1. Tao project Railway va 4 services: `api`, `worker`, `Postgres`, `Redis`.
2. Gan env cho `api`/`worker`.
3. Wire noi bo:
   - `DATABASE_URL` -> Postgres internal URL
   - `REDIS_URL` -> Redis internal URL
4. Dat role process:
   - `api`: `RUN_WORKER=false`
   - `worker`: `RUN_WORKER=true`
5. Chot startup command theo service:
   - `api`: `npm start`
   - `worker`: `npm run worker:prod`
6. Deploy `api` va `worker`.
7. Chay migration production cho Postgres.
8. Gan custom domain backend `api.neuragen.xyz`.
9. Cap nhat lai URL callbacks/webhook backend:
   - `GOOGLE_CALLBACK_URL`
   - `PAYOS_WEBHOOK_URL`
   - `PUBLIC_ASSET_BASE_URL`
10. Redeploy va verify health/log.

## 5) Van de gap phai va cach xu ly

### 5.1 `railway run migrate` loi voi internal DB host

Hien tuong:

- Tu local machine, command migrate co luc khong truy cap duoc `*.railway.internal`.

Xu ly:

- Dung `DATABASE_PUBLIC_URL` cua Postgres cho lenh migrate khi chay tu local.

Bai hoc:

- Internal host chi dam bao trong network runtime cua Railway.
- Job thao tac tu local nen co fallback public URL khi can.

### 5.2 Dat command start worker sai he bien

Hien tuong:

- Worker da deploy nhung khong chay dung entrypoint mong muon.

Xu ly:

- Chot lai bien start/build phu hop builder dang dung.
- Verify bang log worker co event `worker.start.ready` va `worker.bootstrap.started`.

### 5.3 Env callback/payment con `localhost`

Hien tuong:

- OAuth/payOS return URL local gay fail flow tren production.

Xu ly:

- Tach nhom bien:
  - co the chot ngay (backend domain)
  - phai doi FE domain that moi chot duoc

## 6) Trang thai hien tai sau deploy

Da on:

- Backend domain: `https://api.neuragen.xyz`
- Health endpoint tra `ok=true`, `database=true`, `redis=true`
- `worker` da start va consume queue
- DB migrations da apply day du
- Provider stack (Modal/Vast), S3, SMTP, PayOS webhook da duoc set

Chua the chot neu chua co FE production:

- `FRONTEND_URL`
- `OAUTH_ALLOWED_REDIRECT_URIS`
- `PAYOS_RETURN_URL`
- `PAYOS_CANCEL_URL`
- `CORS_ORIGINS` (neu FE goi browser truc tiep)

MoMo:

- Chua dung thi co the bo qua nhom `MOMO_*`.
- Khi bat MoMo can set day du bo env bat buoc.

## 7) Vi sao dung `api.neuragen.xyz` thay vi root domain

- Tach ro frontend/backend theo subdomain de de scale.
- Giam rui ro conflict DNS voi website marketing/landing page.
- De quan ly CORS, OAuth callback, webhook minh bach hon.

## 8) Checklist sau merge main (de tranh drift)

1. Trigger deploy lai tu commit tren `main`.
2. Check `api` health va worker logs.
3. Xac nhan env production khong con key local khong mong muon.
4. Test 1 luong user thuc:
   - login/auth
   - upload asset
   - tao job
   - nhan ket qua

## 9) Ghi chu bao mat

- Tuyet doi khong commit secret that vao git.
- Neu secret da tung lo o noi cong khai:
  - rotate ngay AWS keys
  - rotate SMTP app password
  - rotate Google secret
  - rotate payOS keys

## 10) Tai lieu lien quan

- `docs/deploy-railway.md`: runbook thao tac deploy
- `docs/ops-part-1-health-readiness.md`: health readiness
- `docs/ops-phase-2-logging-monitoring-alert.md`: logging/monitoring

