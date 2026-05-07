export type ProviderId = "cursor" | "codex" | "claude";

export type UsageMetric = {
  id: string;
  label: string;
  usedPercentage: number | null;
  resetAt?: string;
  detail?: string;
};

export type ProviderSnapshot = {
  provider: ProviderId;
  name: string;
  source: "web-collector" | "claude-statusline";
  url?: string;
  title?: string;
  plan?: string;
  collectedAt: string;
  metrics: UsageMetric[];
  status: "ok" | "no-metrics";
  diagnostic?: string;
  rawText?: string;
};

export type UsageStore = {
  updatedAt: string | null;
  providers: Partial<Record<ProviderId, ProviderSnapshot>>;
};
