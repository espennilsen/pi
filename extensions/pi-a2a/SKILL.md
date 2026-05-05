# pi-a2a Long-Running Tasks Skill

## Overview

The pi-a2a extension supports **long-running tasks** that can execute for hours or days without timeouts. This is essential for:

- Data processing pipelines
- Batch operations
- Research and aggregation tasks
- External API jobs with unpredictable duration
- Any A2A task that exceeds the standard timeout

## When to Use

**Use long-running tasks when:**
- Task execution time is unpredictable or known to exceed 10 minutes
- The remote agent is processing large datasets
- Task involves multiple external API calls
- You want the task to survive Pi restarts

**Don't use for:**
- Quick queries (< 5 minutes)
- Interactive conversations
- Tasks requiring immediate feedback

## Configuration

Enable in `settings.json`:

```json
{
  "pi-a2a": {
    "longRunningTasks": {
      "enabled": true,
      "maxTaskAgeHours": 168,
      "resumeRetryAttempts": 3,
      "resumeRetryDelayMs": 5000,
      "pollingIntervalMs": 300000
    }
  }
}
```text

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable long-running task support |
| `maxTaskAgeHours` | number | `168` (7 days) | Maximum task retention period |
| `resumeRetryAttempts` | number | `3` | Retry attempts for resume failures |
| `resumeRetryDelayMs` | number | `5000` | Delay between retries |
| `pollingIntervalMs` | number | `300000` (5 min) | Hub polling interval |

## How It Works

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  1. Task Initiated                                          │
│     - Task state saved to SQLite                            │
│     - Session ID assigned                                   │
│     - Agent continues other work                            │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│  2. Background Polling (every 5 min)                        │
│     - Checks hub for task completion                        │
│     - Detects state changes                                 │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│  3. Task Completes                                          │
│     - State updated in SQLite                               │
│     - Resume request queued                                 │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│  4. Smart Resume Queue                                      │
│     - Waits for agent to be idle                            │
│     - Processes one request at a time                       │
│     - Validates session ID (prevents stale callbacks)       │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│  5. Response Delivered                                      │
│     - Completion message injected into chat                 │
│     - Task result available                                 │
└─────────────────────────────────────────────────────────────┘
```

### Session Persistence

Tasks are stored in `db/a2a-long-running.db` with:
- `taskId` - A2A task identifier
- `contextId` - Conversation context
- `sessionId` - Pi session that owns the task
- `state` - Current task state
- `createdAt` / `lastUpdatedAt` - Timestamps
- `response` / `error` - Task result

### Resume Queue

The resume queue ensures responses are delivered at the right time:

1. **Agent Busy**: Queue the resume request
2. **Agent Idle**: Process immediately
3. **Session Mismatch**: Skip (task belongs to old session)
4. **Failure**: Retry with backoff (up to `resumeRetryAttempts`)

## Usage Patterns

### Pattern 1: Long-Running Data Processing

```typescript
// Send task to data processing agent
const result = await a2a_send({
  agent: "data-processor",
  message: "Process this 10GB dataset...",
});

// Agent continues other work immediately
// Task result delivered when processing completes (hours later)
```

### Pattern 2: Multi-Agent Pipeline

```typescript
// Start long-running pipeline
const pipelineTask = await a2a_send({
  agent: "pipeline-orchestrator",
  message: "Run full ETL pipeline",
});

// Check status periodically or wait for completion notification
// Result delivered automatically when pipeline finishes
```

### Pattern 3: Research Aggregation

```typescript
// Start research task
const researchTask = await a2a_send({
  agent: "research-agent",
  message: "Aggregate all news about AI safety from past month",
});

// Agent can handle other requests while research runs
// Results delivered when aggregation completes
```

## Best Practices

### ✅ Do

1. **Enable for appropriate tasks**: Use when tasks exceed 10 minutes
2. **Monitor task age**: Set `maxTaskAgeHours` appropriately for your use case
3. **Handle failures**: Check for error messages in completion notifications
4. **Test session recovery**: Verify tasks survive Pi restarts
5. **Set reasonable polling intervals**: Balance responsiveness with resource usage

### ❌ Don't

1. **Don't enable for all tasks**: Overhead not needed for quick operations
2. **Don't set polling too low**: < 60 seconds creates unnecessary load
3. **Don't rely on immediate responses**: Long-running tasks are asynchronous
4. **Don't ignore session boundaries**: Tasks belong to specific sessions

## Monitoring

### Check Task Status

```bash
# View pending long-running tasks
sqlite3 db/a2a-long-running.db "SELECT task_id, state, created_at FROM long_running_tasks WHERE state NOT IN ('completed', 'failed');"
```

### Check Resume Queue

```bash
# View queued resume requests
sqlite3 db/a2a-long-running.db "SELECT task_id, priority, retry_count FROM resume_queue ORDER BY enqueued_at;"
```

### Logs to Monitor

- `long_running_task_saved` - Task state persisted
- `long_running_task_completed` - Task finished
- `resume_request_enqueued` - Resume queued
- `resume_queue_processed` - Response delivered
- `resume_queue_retry_scheduled` - Retry scheduled
- `long_running_task_poll_error` - Polling error

## Troubleshooting

### Task Not Completing

**Symptoms**: Task stuck in "working" state for extended period

**Solutions**:
1. Check remote agent health
2. Verify hub connectivity
3. Increase `pollingIntervalMs` if hub is rate-limited
4. Check logs for `long_running_task_poll_error`

### Resume Not Processing

**Symptoms**: Task completed but response not delivered

**Solutions**:
1. Check if agent is busy (resume waits for idle)
2. Verify session ID matches current session
3. Check retry count (may have exhausted retries)
4. Review `resume_queue_*` logs

### Session Mismatch

**Symptoms**: `resume_queue_stale_session` in logs

**Cause**: Task belongs to previous Pi session

**Solutions**:
1. This is expected behavior - prevents cross-session contamination
2. Task result available in previous session's data
3. Consider shorter `maxTaskAgeHours` if this occurs frequently

## Limitations

1. **Hub Dependency**: Requires A2A hub for polling (can't poll direct agents)
2. **Session Boundaries**: Tasks don't cross session boundaries
3. **Polling Latency**: Completion detected within polling interval (default: 5 min)
4. **Storage**: Tasks consume SQLite storage (pruned after `maxTaskAgeHours`)

## Example Configuration

### Development
```json
{
  "pi-a2a": {
    "longRunningTasks": {
      "enabled": true,
      "maxTaskAgeHours": 24,
      "resumeRetryAttempts": 5,
      "pollingIntervalMs": 60000
    }
  }
}
```

### Production
```json
{
  "pi-a2a": {
    "longRunningTasks": {
      "enabled": true,
      "maxTaskAgeHours": 168,
      "resumeRetryAttempts": 3,
      "pollingIntervalMs": 300000
    }
  }
}
```

### Minimal Overhead
```json
{
  "pi-a2a": {
    "longRunningTasks": {
      "enabled": false
    }
  }
}
```

## Related Features

- **A2A Hub**: Task status polling requires hub registration
- **Session Persistence**: Pi stores sessions on disk for recovery
- **Smart Resume Queue**: Respects agent workload before delivering responses
- **Task Timeout**: Standard tasks still have `taskTimeoutMs` (default: 10 min)

## Version History

- **v0.1.0**: Initial implementation
  - LongRunningTaskStore for SQLite persistence
  - Session ID tracking
  - Smart resume queue
  - Background polling
