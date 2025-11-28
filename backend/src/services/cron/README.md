# Cron Scheduler Service

This directory contains the cron scheduler implementation and scheduled jobs that maintain system health and user data.

## Architecture

The cron scheduler is built using `node-cron` and integrates with the application lifecycle in `src/index.ts`. It starts with the application and stops during graceful shutdown.

## Scheduled Jobs

### 1. Subscription Expiration Check (`01:00 UTC Daily`)

**File**: `jobs/subscriptionExpiration.ts`

**Purpose**: Proactively notify users about expiring subscriptions.

**Behavior**:
- Finds active subscriptions expiring within the next 24 hours
- Enqueues notification jobs via NotificationService
- Marks subscriptions with `expiration_reminder_sent` flag in metadata to prevent duplicate notifications
- Logs errors to `error_logs` table for failed notifications

**SQL Operations**:
```sql
SELECT id, user_id, plan_code, plan_name, status, expires_at, metadata
FROM subscriptions
WHERE status = 'active'
  AND expires_at > NOW()
  AND expires_at <= NOW() + INTERVAL '24 hours'
```

### 2. Subscription Cleanup (`02:00 UTC Daily`)

**File**: `jobs/subscriptionCleanup.ts`

**Purpose**: Purge/anonymize data for users with expired subscriptions.

**Behavior**:
- Finds users whose subscriptions expired >2 days ago
- Deletes associated data:
  - Parsing history
  - Audience segments
  - Broadcast campaigns
  - Broadcast logs
- Clears Redis progress keys for those users
- Respects 2-day retention window to allow grace period

**SQL Operations**:
```sql
SELECT DISTINCT user_id
FROM subscriptions
WHERE status = 'expired'
  AND expires_at < NOW() - INTERVAL '2 days'
```

### 3. Payment Check (`Every 5 Minutes`)

**File**: `jobs/paymentCheck.ts`

**Purpose**: Monitor pending payments and manage payment lifecycle.

**Behavior**:
- Finds all payments with `status = 'pending'`
- For payments older than 24 hours:
  - Cancels the payment
  - Enqueues cancellation notification
- For payments older than 30 minutes since last reminder:
  - Enqueues pending payment reminder
  - Updates `last_reminder_at` timestamp in payment payload
- Logs errors to `error_logs` for failed operations

**Constants**:
- Payment window: 24 hours
- Reminder interval: 30 minutes

### 4. Error Log Cleanup (`03:00 UTC Daily`)

**File**: `jobs/errorLogCleanup.ts`

**Purpose**: Clean up old error logs to prevent database bloat.

**Behavior**:
- Deletes error_logs records older than 2 days
- Logs the count of deleted records
- Double-checks TTL-based expiration

**SQL Operations**:
```sql
DELETE FROM error_logs
WHERE created_at < NOW() - INTERVAL '2 days'
```

## Notification Service

**File**: `../notification/notification.service.ts`

**Purpose**: Centralized service for enqueuing notification jobs.

**Functions**:
- `enqueueNotification()` - Generic notification enqueuing
- `enqueueSubscriptionExpirationReminder()` - Subscription expiring soon
- `enqueuePendingPaymentReminder()` - Payment pending reminder
- `enqueuePaymentCancellationNotice()` - Payment cancelled notice

All notifications are enqueued to the Bull queue system via `addJob(JobTypes.NOTIFICATION, ...)`.

## Error Handling

All cron jobs implement comprehensive error handling:

1. **Individual Record Failures**: Caught and logged, but don't stop batch processing
2. **Critical Failures**: Re-thrown after logging to allow the scheduler to continue
3. **Error Persistence**: All errors are stored in the `error_logs` table with:
   - Context information
   - Stack traces
   - User ID (when applicable)
   - 2-day TTL

## Testing

Each job module has corresponding unit tests:
- `subscriptionExpiration.test.ts`
- `subscriptionCleanup.test.ts`
- `paymentCheck.test.ts`
- `errorLogCleanup.test.ts`
- `cronScheduler.test.ts`

Tests use Vitest with mocked database and Redis clients to verify:
- SQL queries are issued correctly
- State transitions happen as expected
- Error handling works properly
- No duplicate notifications are sent

Run tests:
```bash
pnpm test -- src/services/cron --run
```

## Integration

The scheduler is integrated into the application lifecycle in `src/index.ts`:

```typescript
import { startCronJobs, stopCronJobs } from "@/services/cron/cronScheduler";

async function start() {
  await connectDatastores();
  await bootstrapQueues();
  startCronJobs(); // Start cron jobs after queues

  // ...

  const shutdown = async () => {
    await server.close();
    stopCronJobs(); // Stop cron jobs before queues
    await shutdownQueues();
    await disconnectDatastores();
  };
}
```

## Configuration

Cron schedules are defined in `cronScheduler.ts`:
- Subscription expiration: `0 1 * * *` (01:00 UTC daily)
- Subscription cleanup: `0 2 * * *` (02:00 UTC daily)
- Error log cleanup: `0 3 * * *` (03:00 UTC daily)
- Payment check: `*/5 * * * *` (Every 5 minutes)

All jobs use UTC timezone to ensure consistent execution regardless of server location.

## Monitoring

All jobs log structured information:
- Job start/completion with duration
- Record counts (processed, skipped, failed)
- Individual error details

Example log output:
```json
{
  "level": "info",
  "message": "Subscription expiration check completed",
  "duration": 1234,
  "total": 10,
  "notificationsSent": 8,
  "alreadyNotified": 1,
  "errors": 1
}
```
