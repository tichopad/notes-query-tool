# Queue Spike Postmortem

## Summary
On 2026-06-21 we saw a short but noisy queue spike during a campaign send window. Background processing lag increased for about 18 minutes, workers ran near saturation, and several low-priority jobs missed their expected completion time. User-facing traffic stayed mostly healthy, but internal dashboards showed rising backlog depth and delayed retries.

## What Happened
The trigger was a burst of campaign traffic landing at the same time as a scheduled batch import. That combination pushed the job queue beyond normal concurrency assumptions. As workers slowed, visibility timeouts and retry behavior amplified the load, creating a small retry storm. The queue drained once the import finished and retry volume fell back to baseline.

## Impact
No data loss was found. Some notification and enrichment tasks completed late, and a few background processing steps ran more than once before deduplication settled state. On-call intervention was limited to pausing one nonessential consumer and raising worker count for the highest priority queue.

## Follow-up
We should separate campaign-triggered jobs from bulk maintenance work, tighten retry backoff, and add alerts on queue age instead of depth alone. Capacity testing should include worker saturation scenarios and mixed traffic patterns.
