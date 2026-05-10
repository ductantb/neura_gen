# Explore System

Tai lieu nay tong hop toan bo phan `explore` da duoc lam trong backend hien tai, bao gom:
- mo hinh du lieu
- luong dong bo `Post -> ExploreItem`
- public explore
- tim kiem theo chu de
- feed `for_you`
- event tracking va topic profile
- debug ranking noi bo
- test da co
- gioi han va huong mo rong

## 1. Muc tieu cua Explore

He thong `explore` duoc tach khoi `post`:
- `Post` la du lieu goc do user push len.
- `ExploreItem` la ban ghi da duoc chuan hoa de phuc vu hien thi tren trang explore.

Ly do tach:
- co the tinh san `score`, `topic`, `isTrending`
- co the rank doc lap voi `Post`
- co cho de luu cac tin hieu ca nhan hoa ma khong lam phuc tap bang `Post`

Ket luan nghiep vu:
- user upload / sua / like / comment tac dong len `Post`
- `ExploreService.syncPost()` dong bo lai sang `ExploreItem`
- frontend explore nen doc `ExploreItem`, khong doc thang `Post`

## 2. Data Model

### 2.1 ExploreItem

Bang `ExploreItem` luu item hien thi tren explore:
- `postId`: lien ket 1-1 voi `Post`
- `assetVersionId`: media chinh de render
- `title`: rut gon tu `caption`
- `topic`: chu de da duoc chuan hoa
- `score`: diem xep hang toan cuc
- `isTrending`: co dang hot hay khong
- `createdAt`: thoi diem tao record explore

Index hien co:
- `score`
- `topic`
- `isTrending`

Luu y:
- feed `new` va mot phan `for_you` da duoc sua de dua vao `Post.createdAt`, khong dua vao `ExploreItem.createdAt`, tranh truong hop resync lam bai cu bi day len nhu bai moi.

### 2.2 Post

`Post` van la nguon du lieu goc:
- `caption`
- `isPublic`
- `likeCount`
- `commentCount`
- `viewCount`
- `createdAt`

`ExploreItem` duoc sinh tu `Post` public.

### 2.3 ExploreInteraction

Bang ghi nhan hanh vi user tren explore:
- `IMPRESSION`
- `OPEN_POST`
- `WATCH_3S`
- `WATCH_50`
- `LIKE`
- `COMMENT`
- `FOLLOW_CREATOR`
- `HIDE`

Moi event luu:
- `userId`
- `postId`
- `topic`
- `eventType`
- `weight`
- `metadata`
- `createdAt`

Index:
- `[userId, createdAt]`
- `[postId, createdAt]`
- `[userId, eventType, createdAt]`

### 2.4 UserTopicProfile

Ho so so thich theo chu de cua user:
- `userId`
- `topic`
- `score`
- `lastEventAt`
- `updatedAt`

Day la input chinh cho retrieval va ranking cua `for_you`.

### 2.5 HiddenPost

Bang nay luu cac post user da an khoi explore:
- `userId`
- `postId`
- `reason`

Tat ca truy van explore/for_you deu loai bo cac `postId` nay.

### 2.6 Follow

`Follow` la quan he `user -> user`, khong phai `user -> post`.

Explore chi dung `follow` theo 2 cach:
- de lay candidate tu cac creator dang follow
- de ghi them event `FOLLOW_CREATOR` neu hanh dong follow xay ra tu card explore va co `sourcePostId`

## 3. Dong bo Post sang ExploreItem

### 3.1 Khi nao sync

`ExploreService.syncPost(postId)` dang duoc goi tu:
- `PostsService.create()`
- `PostsService.update()`
- `CommentsService.create()`
- `CommentsService.remove()`
- `PostLikesService.create()`
- `PostLikesService.remove()`
- cron `refreshExploreScores()`

Neu `Post.isPublic = false`:
- `ExploreItem` cua post do se bi xoa.

Neu `Post.isPublic = true`:
- `ExploreItem` se duoc `upsert`.

### 3.2 Du lieu sync

Khi sync:
- `title` duoc lay boi `extractTitle(caption)`
- `topic` duoc lay boi `extractTopic(caption)`
- `score` duoc tinh lai
- `isTrending` duoc tinh lai

### 3.3 Rule tinh topic

`extractTopic()` hien tai theo thu tu:
1. neu caption co hashtag `#...` thi dung hashtag dau tien
2. neu khong, match keyword:
   - `anime|manga|otaku` -> `anime`
   - `cinematic|movie|film` -> `cinematic`
   - `portrait|face|selfie` -> `portrait`
   - `landscape|nature|forest|mountain` -> `landscape`
   - `scifi|sci-fi|cyberpunk|future` -> `scifi`
3. neu khong match -> `general`

Gioi han:
- topic hien van la `single-label`
- chat luong phu thuoc vao caption

## 4. Public Explore

Endpoint:
- `GET /explore`

Muc dich:
- tra ve feed public cho guest va user da dang nhap

Ho tro query:
- `topic`
- `trending`
- `mode=trending|new|top`
- `sort=score|newest`
- `limit`
- `cursor`

Logic:
- chi lay `post.isPublic = true`
- `mode=trending`: uu tien item `isTrending = true`
- `mode=new` hoac `sort=newest`: sort theo `Post.createdAt desc`, tie-break bang `score`
- `mode=top` hoac `sort=score`: sort theo `score desc`, tie-break bang `Post.createdAt`

Tra ve:
- `mode`
- `data`
- `nextCursor`
- `limit`

## 5. Search Theo Chu De

Endpoint:
- `GET /explore/search?topic=anime`

Muc dich:
- tim `ExploreItem` theo chu de da duoc chuan hoa

Luu y:
- day la search theo `ExploreItem.topic`, khong phai full-text search tren caption
- ket qua tra ve la `ExploreItem`, khong phai `Post`

Co the truyen them:
- `sort=score|newest`
- `trending=true|false`
- `limit`
- `cursor`

Noi bo endpoint nay goi lai `getExplore()` voi `mode='top'`.

## 6. Feed For You

Endpoint:
- `GET /explore/for-you`

Endpoint nay can auth.

### 6.1 Candidate Retrieval

`for_you` hien tai lay candidate tu 4 nhom:
- `topicCandidates`: theo cac topic user co score duong trong `UserTopicProfile`
- `followCandidates`: bai moi tu creator user dang follow
- `trendingCandidates`: bai dang hot toan cuc
- `freshCandidates`: bai moi nhat de tranh feed bi qua cu

Sau do:
- merge theo `ExploreItem.id`
- bo cac bai user da `hide`

### 6.2 Fallback

Neu user chua co profile topic va cung chua follow ai:
- `for_you` se fallback sang `trending`

Response se co:
- `mode: "for_you"`
- `fallback: "trending"`

### 6.3 Ranking Signals

Moi candidate duoc tinh `personalScore` tu:
- `base score`: `ExploreItem.score`
- `topicBonus`: theo `UserTopicProfile` sau khi decay theo thoi gian
- `followBonus`: bonus neu creator nam trong danh sach dang follow
- `creatorBonus`: bonus neu user tung co positive interaction voi creator do
- `freshnessBonus`: uu tien bai moi theo `Post.createdAt`
- `positiveFeedbackBonus`: duoc cong them tu `LIKE`, `COMMENT` cua user tren post do
- `unseenBoost`: boost nhe neu user chua thay post do
- `seenPenalty`: phat bai user da gap nhieu lan
- `skipPenalty`: phat bai co nhieu impression hon open_post

Cong thuc tong quat:
- `personalScore = base + topic + follow + creator + freshness + positive + unseen - seenPenalty - skipPenalty`

### 6.4 Decay

Co 2 lop decay:

#### Topic decay
- `UserTopicProfile.score` khong duoc dung truc tiep
- score se bi giam theo tuoi cua `updatedAt`

Muc dich:
- so thich gan day manh hon so thich cu

#### Interaction decay
- creator affinity duoc tinh tu `ExploreInteraction` positive gan day
- event cu se bi giam trong luong theo thoi gian

Muc dich:
- user vua tuong tac voi creator nao thi creator do duoc uu tien hon

### 6.5 Anti-Repetition

Sau khi tinh diem:
- he thong chay them mot buoc `diversification`
- neu nhieu item lien tiep den tu cung mot creator, cac item sau se bi tru diem them

Muc dich:
- tranh dau feed bi day qua nhieu bai cua cung 1 nguoi

### 6.6 Signals Tra Ve

Response `for_you` mac dinh se co:
- `mode`
- `data`
- `nextCursor`
- `limit`
- `signals.topTopics`
- `signals.followingCreators`

`signals` dung de frontend/dev quan sat tong quan feed, khong phai chi tiet score tung item.

## 7. Event Tracking

### 7.1 Single Event

Endpoint:
- `POST /explore/events`

Dung khi:
- can ghi 1 event le

Input:
- `postId`
- `eventType`
- `metadata?`

Output:
- `ok`
- `postId`
- `topic`
- `eventType`
- `weight`

### 7.2 Batch Event

Endpoint:
- `POST /explore/events/batch`

Dung khi:
- frontend muon gom event gui theo lo, nhat la `IMPRESSION`

Gioi han:
- 1 den 100 event / request

He thong se:
- normalize event
- dedupe `IMPRESSION`
- bo event invalid
- tim topic cua post
- ghi `ExploreInteraction`
- cap nhat `UserTopicProfile`
- ghi `HiddenPost` neu event la `HIDE`

Output co:
- `requested`
- `acceptedCount`
- `recordedCount`
- `skippedCount`
- `groupedByType`
- `topicUpdates`
- `hiddenPostCount`

### 7.3 Event Weights

Trong so hien tai:
- `IMPRESSION = 0.2`
- `OPEN_POST = 1`
- `WATCH_3S = 1.5`
- `WATCH_50 = 2.5`
- `LIKE = 3`
- `COMMENT = 4`
- `FOLLOW_CREATOR = 3.5`
- `HIDE = -8`

Y nghia:
- event positive tang score topic / creator
- event negative lam giam profile hoac an post

## 8. Tich hop voi Post, Like, Comment, Follow

### 8.1 Post

`PostsService` da:
- tao / sua post xong se `syncPost()`
- `GET post` tra them `thumbnailUrl` va `videoUrl`
- media URL duoc resolve tu `objectKey` qua signed URL, fallback sang `fileUrl`

Phan nay quan trong voi explore vi:
- explore item dung `assetVersion`
- frontend khi mo post detail co media day du

### 8.2 Like

`PostLikesService` da:
- tang / giam `likeCount`
- goi `syncPost()` sau create/remove

Tac dung:
- `ExploreItem.score` duoc lam moi theo engagement moi nhat

### 8.3 Comment

`CommentsService` da:
- tang / giam `commentCount`
- goi `syncPost()` sau create/remove

Tac dung:
- `ExploreItem.score` duoc cap nhat lai

### 8.4 Follow

`FollowsService` da:
- tao quan he `user -> user`
- neu request co `sourcePostId` hop le, backend tu dong ghi them event `FOLLOW_CREATOR`

Dieu kien ghi event:
- `sourcePostId` ton tai
- post do la public
- chu post trung voi `followingId`

Muc dich:
- giu duoc ngu canh "user follow creator tu mot bai explore"

## 9. Debug Ranking Noi Bo

### 9.1 Cach bat

Query:
- `GET /explore/for-you?debug=true`

Nhung `debug=true` chi co tac dung neu server-side env bat:
- `EXPLORE_FOR_YOU_DEBUG_ENABLED=true`

Mac dinh trong `.env`:
- `EXPLORE_FOR_YOU_DEBUG_ENABLED=false`

Ket qua:
- production client khong the tu y them query param de lay ranking breakdown neu backend khong bat co nay

### 9.2 Response Debug

Khi debug duoc bat, response se co them:

Top-level:
- `debug.candidateCount`
- `debug.interactionSampleCount`
- `debug.preferredTopics`
- `debug.followingIds`

Per item:
- `candidateSources`
- `baseScore`
- `topicBonus`
- `followBonus`
- `creatorBonus`
- `freshnessBonus`
- `positiveFeedbackBonus`
- `unseenBoost`
- `seenPenalty`
- `skipPenalty`
- `finalScore`
- `topicAffinity`
- `creatorAffinity`
- `seenCount`
- `ageHours`

Muc dich:
- tuning heuristic
- giai thich vi sao item duoc day len
- debug candidate retrieval va ranking

## 10. Test Da Co

### 10.1 Explore Query / Contract

Da co test cho:
- khong cho `mode=for_you` di qua public `GET /explore`
- chap nhan `debug=true` la boolean string hop le

### 10.2 Explore Controller

Da co test cho:
- route `GET /explore/search` goi dung `searchByTopic()`

### 10.3 Explore Service

Da co test cho:
- feed public `new` sort theo `Post.createdAt`
- search topic tra ve theo contract cua public top feed
- `for_you` dung `Post.createdAt` de tinh freshness
- `for_you` boost creator ma user tuong tac gan day
- `for_you` chi tra debug breakdown khi server-side flag duoc bat
- `for_you` khong lo debug khi flag tat

### 10.4 Post / Explore lien quan

Ngoai explore thuần, da co them test cho:
- `GET /posts/:id` tra `thumbnailUrl` / `videoUrl`
- unit test cho map media trong `PostsService`
- integration/e2e test cho endpoint `GET /posts/:id`

## 11. Gioi Han Hien Tai

1. Topic van suy tu `caption`
- chua co `topic` explicit trong `Post`
- chua co multi-topic

2. Search theo topic la exact-match
- khong phai semantic search
- khong phai full-text search

3. Ranking van la heuristic
- chua co embedding
- chua co learning-to-rank
- chua co A/B test infra

4. Event schema chua sau
- chua co watch duration chi tiet
- chua co share/save
- chua co explicit "not interested topic"

5. Feed `findAll` cua `posts` chua pagination
- khong phai van de truc tiep cua explore
- nhung neu frontend dung sai endpoint thi se gap scale issue

## 12. Huong Mo Rong Hop Ly

Thu tu khuyen nghi:

1. Them `topic` explicit vao `Post`
- co the cho single-topic truoc
- ve sau mo rong sang multi-topic / join table

2. Mo rong event schema
- `WATCH_90`
- `DWELL`
- `SHARE`
- `SAVE`
- `NOT_INTERESTED_TOPIC`

3. Them tooling debug cho frontend internal
- an sau feature flag
- cho phep QA xem ly do rank

4. Sau khi data sach hon moi xet:
- vector similarity / embedding
- learning-to-rank model nho

Khong khuyen nghi dung LLM truc tiep trong request-time ranking.

## 13. Bien Moi Truong Lien Quan

Bien da dung cho explore:
- `EXPLORE_FOR_YOU_DEBUG_ENABLED=false`

Y nghia:
- `false`: backend khong tra debug breakdown du client co goi `?debug=true`
- `true`: cho phep lay debug breakdown de tune `for_you`

Khuyen nghi van hanh:
- local / internal QA: co the bat `true`
- production: giu `false`
