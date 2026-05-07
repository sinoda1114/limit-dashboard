import { getRedis } from "./redis-store";

type CollectorCommand = {
  id: string;
  requestedAt: string;
};

type CollectorStatus = {
  state: "idle" | "requested" | "started" | "completed" | "failed";
  message: string;
  commandId?: string;
  updatedAt: string;
};

const globalForCollector = globalThis as typeof globalThis & {
  aiUsageCollectorCommand?: CollectorCommand | null;
  aiUsageCollectorStatus?: CollectorStatus;
};

const commandKey = "ai-usage-cockpit:collector-command";
const statusKey = "ai-usage-cockpit:collector-status";

const defaultStatus = (): CollectorStatus => ({
  state: "idle",
  message: "巡回依頼はまだありません。",
  updatedAt: new Date().toISOString(),
});

export async function createCollectorCommand() {
  const command = {
    id: crypto.randomUUID(),
    requestedAt: new Date().toISOString(),
  };
  const status: CollectorStatus = {
    state: "requested",
    commandId: command.id,
    message: "巡回依頼を登録しました。Chrome拡張が最大1分以内に拾います。",
    updatedAt: new Date().toISOString(),
  };

  const redis = getRedis();
  if (redis) {
    await redis.set(commandKey, command, { ex: 300 });
    await redis.set(statusKey, status, { ex: 600 });
    return { command, status };
  }

  globalForCollector.aiUsageCollectorCommand = command;
  globalForCollector.aiUsageCollectorStatus = status;
  return { command, status };
}

export async function getCollectorCommand() {
  const redis = getRedis();
  if (redis) {
    return {
      command: (await redis.get<CollectorCommand>(commandKey)) ?? null,
      status: (await redis.get<CollectorStatus>(statusKey)) ?? defaultStatus(),
    };
  }

  return {
    command: globalForCollector.aiUsageCollectorCommand ?? null,
    status: globalForCollector.aiUsageCollectorStatus ?? defaultStatus(),
  };
}

export async function updateCollectorStatus(status: Omit<CollectorStatus, "updatedAt">) {
  const next = {
    ...status,
    updatedAt: new Date().toISOString(),
  };

  const redis = getRedis();
  if (redis) {
    await redis.set(statusKey, next, { ex: 600 });
    return next;
  }

  globalForCollector.aiUsageCollectorStatus = next;
  return globalForCollector.aiUsageCollectorStatus;
}
