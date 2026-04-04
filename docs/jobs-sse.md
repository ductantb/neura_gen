# Jobs SSE Integration Guide

This document explains how the frontend should connect to and use the job progress SSE stream.

## Overview

The backend exposes a single-job SSE stream:

- Endpoint: `GET /jobs/:id/events`
- Content type: `text/event-stream`
- Auth: `Authorization: Bearer <access_token>`

The stream is designed for live progress tracking of one generation job at a time.

When the frontend connects, the server sends:

1. A `snapshot` event immediately
2. Live `status` events as the worker updates progress
3. Live `log` events for important lifecycle messages
4. A `heartbeat` event every 15 seconds to keep the connection warm

This means the frontend does not need to call a separate "get current progress" endpoint before opening the stream. The first `snapshot` already contains the current state.

## Important Auth Note

The SSE endpoint is protected by the same JWT guard as the rest of the API.

Because native browser `EventSource` does not support custom `Authorization` headers, the recommended frontend client is:

- `@microsoft/fetch-event-source`

If the frontend uses native `EventSource`, it will not be able to send the bearer token unless auth is moved to cookies or a different auth mechanism is added.

## Endpoint

```http
GET /jobs/:id/events
Authorization: Bearer <access_token>
Accept: text/event-stream
```

Example:

```bash
curl -N \
  -H "Accept: text/event-stream" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  http://localhost:3000/jobs/JOB_ID/events
```

## Event Types

The stream currently emits 4 event types.

### 1. `snapshot`

Sent immediately after connection opens.

Purpose:

- hydrate the UI with the current job state
- restore state after reconnect
- provide recent logs without requiring an extra REST call

Payload shape:

```json
{
  "jobId": "job_123",
  "status": "PROCESSING",
  "progress": 60,
  "errorMessage": null,
  "provider": "modal",
  "modelName": "wan2.2-ti2v-standard",
  "presetId": "standard_wan22_ti2v",
  "workflow": "TI2V",
  "createdAt": "2026-04-01T10:00:00.000Z",
  "updatedAt": "2026-04-01T10:02:10.000Z",
  "startedAt": "2026-04-01T10:00:20.000Z",
  "completedAt": null,
  "failedAt": null,
  "logs": [
    {
      "jobId": "job_123",
      "message": "Job queued",
      "createdAt": "2026-04-01T10:00:05.000Z"
    }
  ]
}
```

Notes:

- `logs` contains recent job logs from the database.
- `snapshot` is the source of truth when the client reconnects.
- If the job is already terminal, `snapshot.status` will already be `COMPLETED`, `FAILED`, or `CANCELLED`.

### 2. `status`

Sent whenever the backend updates job status or progress.

Payload shape:

```json
{
  "jobId": "job_123",
  "status": "PROCESSING",
  "progress": 80,
  "errorMessage": null,
  "startedAt": "2026-04-01T10:00:20.000Z",
  "completedAt": null,
  "failedAt": null,
  "occurredAt": "2026-04-01T10:03:40.000Z"
}
```

Notes:

- `progress` is not a continuous percentage from the model provider.
- It reflects backend lifecycle milestones.
- The worker currently emits major checkpoints such as:
  - `5`
  - `15`
  - `30`
  - `60`
  - `80`
  - `90`
  - `95`
  - `100`

This is intentional and should be presented in the UI as staged progress, not exact provider-side inference percent.

### 3. `log`

Sent when the backend writes an important job log.

Payload shape:

```json
{
  "jobId": "job_123",
  "message": "Attempt 1 failed, retrying: provider timeout",
  "createdAt": "2026-04-01T10:05:00.000Z"
}
```

Typical messages:

- `Job queued`
- `Job canceled by user`
- `Attempt 1 failed, retrying: ...`
- `Job failed permanently: ...`

Recommended frontend usage:

- append to a job timeline
- show in a collapsible "details" panel
- surface the latest log in toast/debug UI if needed

### 4. `heartbeat`

Sent every 15 seconds.

Payload shape:

```json
{
  "jobId": "job_123",
  "timestamp": "2026-04-01T10:05:15.000Z"
}
```

Recommended frontend usage:

- usually ignore it
- optionally use it to display connection health

## Job Statuses

The frontend should expect these statuses:

- `PENDING`
- `QUEUED`
- `PROCESSING`
- `COMPLETED`
- `FAILED`
- `CANCELLED`

Terminal statuses:

- `COMPLETED`
- `FAILED`
- `CANCELLED`

When a terminal status is received, the frontend should usually:

1. update the UI
2. optionally fetch final job details or result
3. close the SSE connection for that job

## Recommended Frontend Flow

### Create job

Call:

```http
POST /jobs/video
```

Then read `jobId` from the response.

### Open stream

Open:

```http
GET /jobs/:id/events
```

### Render state

Recommended mapping:

- `snapshot`:
  - initialize job state
  - initialize timeline/logs
- `status`:
  - update progress bar
  - update badge/status text
  - detect terminal state
- `log`:
  - append timeline entry
- `heartbeat`:
  - ignore or use for connection diagnostics

### On completion

When status becomes `COMPLETED`, call:

```http
GET /jobs/:id/result
```

or

```http
GET /jobs/:id
```

Use these REST endpoints to fetch:

- output asset URL
- thumbnail URL
- richer job metadata

The SSE stream itself does not include signed download URLs.

## Recommended Frontend Client Example

Example with `@microsoft/fetch-event-source`:

```ts
import { fetchEventSource } from '@microsoft/fetch-event-source';

type JobSnapshotEvent = {
  jobId: string;
  status: string;
  progress: number;
  errorMessage: string | null;
  provider: string | null;
  modelName: string | null;
  presetId: string | null;
  workflow: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  logs: Array<{
    jobId: string;
    message: string;
    createdAt: string;
  }>;
};

type JobStatusEvent = {
  jobId: string;
  status: string;
  progress: number;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  occurredAt: string;
};

type JobLogEvent = {
  jobId: string;
  message: string;
  createdAt: string;
};

type JobHeartbeatEvent = {
  jobId: string;
  timestamp: string;
};

export async function subscribeJobEvents({
  baseUrl,
  jobId,
  accessToken,
  onSnapshot,
  onStatus,
  onLog,
  onHeartbeat,
}: {
  baseUrl: string;
  jobId: string;
  accessToken: string;
  onSnapshot: (data: JobSnapshotEvent) => void;
  onStatus: (data: JobStatusEvent) => void;
  onLog: (data: JobLogEvent) => void;
  onHeartbeat?: (data: JobHeartbeatEvent) => void;
}) {
  const controller = new AbortController();

  await fetchEventSource(`${baseUrl}/jobs/${jobId}/events`, {
    method: 'GET',
    headers: {
      Accept: 'text/event-stream',
      Authorization: `Bearer ${accessToken}`,
    },
    signal: controller.signal,
    onopen(response) {
      if (!response.ok) {
        throw new Error(`Failed to open SSE: ${response.status}`);
      }
    },
    onmessage(event) {
      if (!event.data) {
        return;
      }

      const payload = JSON.parse(event.data);

      switch (event.event) {
        case 'snapshot':
          onSnapshot(payload as JobSnapshotEvent);
          break;
        case 'status':
          onStatus(payload as JobStatusEvent);
          break;
        case 'log':
          onLog(payload as JobLogEvent);
          break;
        case 'heartbeat':
          onHeartbeat?.(payload as JobHeartbeatEvent);
          break;
      }
    },
    onerror(error) {
      throw error;
    },
  });

  return () => controller.abort();
}
```

## Reconnect Strategy

Recommended frontend behavior:

- reconnect automatically if the network drops
- when reconnected, trust the next `snapshot`
- de-duplicate logs by `createdAt + message` or by local timeline rules if needed

Why this works:

- the backend sends a fresh `snapshot` on every connection
- `snapshot` includes recent logs
- live updates continue from the current backend state

## What SSE Does Not Replace

SSE is for live updates only.

The frontend should still use the existing REST endpoints for:

- creating jobs
- listing jobs
- reading full job details
- getting final output URLs
- canceling a job

Relevant endpoints:

- `POST /jobs/video`
- `GET /jobs`
- `GET /jobs/:id`
- `GET /jobs/:id/result`
- `POST /jobs/:id/cancel`

## Current Backend Behavior Notes

- The SSE endpoint is scoped to a single job.
- The backend does not currently auto-close the connection on terminal state.
- The frontend should close the stream after:
  - `COMPLETED`
  - `FAILED`
  - `CANCELLED`
- The stream is backed by Redis pub/sub plus database snapshot data.
- If a client is offline and reconnects later, `snapshot` restores the latest state.

## Suggested FE UX

- Use a progress bar for `progress`
- Use a status badge for `status`
- Use a timeline panel for `log`
- Show a "processing" screen for `PENDING`, `QUEUED`, `PROCESSING`
- Show result UI only after `COMPLETED`
- Show retry/debug messages from `log`
- On `FAILED`, display both:
  - `errorMessage` from the latest state
  - the latest `log` entry if available
