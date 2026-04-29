# Retry Pipeline Review

## Context
Reviewed the current retry path for campaign sends handled by SQS-backed background jobs. The main concern is not correctness of single-message delivery, but how retries change queue depth during peak send windows. When workers fall behind, delayed retries can overlap with fresh campaign batches and make throughput look better in dashboards than it feels in practice.

## Findings
The existing retry policy is probably too uniform. Transient provider errors, worker timeouts, and malformed payloads are all re-entering the same queue with similar delay rules. That increases noise for operators and lets low-value jobs compete with valid campaign sends. We also saw that a worker restart can briefly double visible backlog while leases are still expiring.

## Options
Split retry traffic into a separate queue with a lower worker concurrency cap. Keep first-attempt campaign sends on the primary path, and move second or third attempts into a slower lane. Another option is to have cron workers sweep failed records every few minutes instead of immediately re-queueing everything.

## Next Step
Run a small load test focused on worker saturation, retry age, and end-to-end campaign throughput under partial downstream failures.
