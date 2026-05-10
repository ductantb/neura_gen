# Deploy Neura Gen Backend len Railway (Chi tiet)

Tai lieu nay gom 2 phan:

- Runbook de deploy lai (co the lam lai tu dau)
- Deployment notes de ghi lai: da lam gi, thay doi gi, vi sao lam nhu vay

## 1) Muc tieu dot deploy

- Dua backend len production domain: `https://api.neuragen.xyz`
- Tach rieng `api` va `worker` tren Railway de xu ly BullMQ on dinh
- Chuan hoa bien moi truong tu local -> production
- Dam bao healthcheck, migration, queue processing va provider routing hoat dong

## 2) Kien truc production da chot

4 services trong cung 1 Railway project:

- `api`: NestJS HTTP service
- `worker`: BullMQ worker process
- `postgres`: Railway PostgreSQL
- `redis`: Railway Redis

Luong runtime:

```text
Client -> api.neuragen.xyz (api)
                   -> Postgres
                   -> Redis/BullMQ -> worker -> Vast/Modal -> S3
```

## 3) Da lam gi trong dot deploy nay

### 3.1 Chuan hoa runtime scripts

Da xac nhan va dung cac scripts sau:

- `npm run build` (co `prebuild` de `prisma generate`)
- `npm start` (chay `node dist/src/main.js`)
- `npm run worker:prod` (chay worker production)
- `npm run migrate:deploy` (apply migration cho prod DB)

Ly do:

- Tranh loi thieu Prisma Client tren moi truong build moi
- Tach ro command cho API va worker, de Railway deploy dung process

### 3.2 Chuan hoa healthcheck va readiness

- Dung `GET /health` lam healthcheck path cho Railway
- Health check theo readiness (database + redis), khong chi process song

Ly do:

- Deploy/restart se duoc platform danh gia dung trang thai he thong
- Giam false-positive "service up" nhung DB/Redis dang loi

### 3.3 Chuan hoa Redis env compatibility

Da thong nhat cach doc Redis env:

- Uu tien `REDIS_URL`
- Fallback `REDIS_HOST` + `REDIS_PORT`
- Tuong thich naming env Railway khi can

Ly do:

- Chay duoc ca local/docker/railway ma khong can forking config

### 3.4 Tu dong hoa deploy

Da dung/bo sung scripts:

- `npm run env:check:prod`
- `npm run railway:sync:api`
- `npm run railway:sync:worker`
- `npm run railway:deploy`

Ly do:

- Giam sai sot thao tac tay khi sync env
- Rut ngan thoi gian deploy lan sau

### 3.5 DNS va custom domain

- Domain backend final da chot: `api.neuragen.xyz`
- DNS tai Namecheap theo record Railway yeu cau (CNAME + TXT verify)

Ly do:

- Tach backend domain rieng de FE/goi API/SDK/oauth cau hinh ro rang

## 4) Thay doi env quan trong (local -> production)

Cac bien duoi day can doi khoi gia tri local:

- `PUBLIC_ASSET_BASE_URL`: `https://api.neuragen.xyz/public`
- `GOOGLE_CALLBACK_URL`: `https://api.neuragen.xyz/auth/google/callback`
- `PAYOS_WEBHOOK_URL`: `https://api.neuragen.xyz/billing/webhooks/payos`

Cac bien phu thuoc FE production (co the de tam local khi chua co FE prod):

- `FRONTEND_URL`
- `OAUTH_ALLOWED_REDIRECT_URIS`
- `PAYOS_RETURN_URL`
- `PAYOS_CANCEL_URL`
- `CORS_ORIGINS`

Luu y:

- Neu chua co FE production, backend van deploy/chay duoc
- Nhung OAuth redirect va payment return se chua test end-to-end voi FE

## 5) Runbook deploy lai tu dau

### Buoc 1: Tao service

Tao 4 service: `api`, `worker`, `postgres`, `redis`.

### Buoc 2: Cau hinh `api`

- Build Command: `npm run build`
- Start Command: `npm start`
- Healthcheck Path: `/health`
- Env bat buoc:
  - `RUN_WORKER=false`
  - `DATABASE_URL` (reference tu postgres)
  - `REDIS_URL` (reference tu redis)
  - bo env app (JWT/S3/provider/mail/oauth/billing...)

### Buoc 3: Cau hinh `worker`

- Build Command: `npm run build`
- Start Command: `npm run worker:prod`
- Env:
  - `RUN_WORKER=true`
  - dung cung bo env voi `api`

### Buoc 4: Deploy lan dau

- Deploy `api`
- Deploy `worker`

### Buoc 5: Migrate database

Thuc hien:

```bash
npm run migrate:deploy
```

(run trong Railway shell cua `api` hoac qua CLI)

### Buoc 6: Gan custom domain

- Add custom domain: `api.neuragen.xyz` vao service `api`
- Them dung DNS records Railway yeu cau tai Namecheap
- Doi verify xong

### Buoc 7: Verify sau deploy

- `GET https://api.neuragen.xyz/health` tra `200`
- Worker log co dong khoi dong thanh cong va consume queue
- Tao thu 1 job video de kiem tra queue + provider + storage

## 6) Van de da gap va cach xu ly

### Van de 1: Env con localhost

Trieu chung:

- OAuth/PayOS/asset URL tra ve local URL

Xu ly:

- Chot lai env production theo domain `api.neuragen.xyz`
- Tach nhom env phu thuoc FE de cap nhat sau khi co FE prod

### Van de 2: Script sync env gap key rong

Trieu chung:

- CLI co the loi voi key co gia tri rong

Xu ly:

- Script sync bo qua key rong va log canh bao

### Van de 3: Worker command sai

Trieu chung:

- Queue khong duoc consume du `api` van song

Xu ly:

- Chot `worker` dung `npm run worker:prod`
- Check log khoi dong worker sau moi lan deploy

## 7) Trang thai hien tai sau deploy

Da on:

- backend domain production: `https://api.neuragen.xyz`
- health endpoint hoat dong
- api/worker tach rieng va van hanh doc lap

Can theo doi khi go-live FE:

- cap nhat full redirect/payment URLs theo FE production
- set `CORS_ORIGINS` theo FE domain that
- test full flow: OAuth, reset password link, payOS return/cancel

## 8) Tai sao cach nay la toi uu cho hien trang

- It rui ro: giu nguyen kien truc backend hien co, chi chuan hoa runtime/env/deploy
- De rollback: tach `api`/`worker` nen loi ben nao co the xu ly rieng
- De van hanh: co healthcheck, scripts deploy, checklist verify sau deploy
- De mo rong: khi tang tai co the scale `api` va `worker` doc lap

## 9) Checklist moi lan deploy tiep theo

1. Pull commit moi nhat tren `main`.
2. Chay `npm run env:check:prod`.
3. Sync env (`railway:sync:api` va `railway:sync:worker`) neu co doi env.
4. Deploy `api` va `worker`.
5. Chay `npm run migrate:deploy` neu co migration moi.
6. Check `/health`.
7. Check worker logs.
8. Smoke test: auth -> upload -> create job -> get result.

---

Neu can, co the tao them mot file rieng "go-live checklist" ngan gon cho team ops/qa de dung truoc moi release.


