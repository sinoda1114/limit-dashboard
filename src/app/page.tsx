"use client";

import {
  AlertCircle,
  Bot,
  Clock3,
  Code2,
  RefreshCcw,
  TerminalSquare,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { ProviderId, ProviderSnapshot, UsageMetric, UsageStore } from "@/lib/usage-types";

const providers: Array<{
  id: ProviderId;
  name: string;
  product: string;
  accent: string;
  url: string;
  collector: string;
}> = [
  {
    id: "cursor",
    name: "Cursor",
    product: "Subscription spending",
    accent: "#9ca3af",
    url: "https://cursor.com/ja/dashboard/spending",
    collector: "Web Collector",
  },
  {
    id: "codex",
    name: "Codex",
    product: "Cloud analytics usage",
    accent: "#a78bfa",
    url: "https://chatgpt.com/codex/cloud/settings/analytics#usage",
    collector: "Web Collector",
  },
  {
    id: "claude",
    name: "Claude",
    product: "Claude.ai usage / Claude Code limits",
    accent: "#e59b62",
    url: "https://claude.ai/settings/usage",
    collector: "Web Collector + statusLine",
  },
];

function usedLabel(metric: UsageMetric) {
  if (metric.usedPercentage == null) return metric.detail ?? "不明";
  return `${metric.usedPercentage}% 使用済み`;
}

function metricLabelJa(label: string) {
  if (/^total$/i.test(label)) return "合計";
  if (/^api$/i.test(label)) return "API";
  if (/^auto\s*\+\s*composer$/i.test(label)) return "Auto + Composer";
  if (/^no data$/i.test(label)) return "データなし";
  return label;
}

function metricSubline(metric: UsageMetric) {
  if (metric.id === "codex-credits") {
    return "クレジットを使うと、プランの上限を超えても Codex を引き続き利用できます";
  }
  return `リセット: ${formatReset(metric.resetAt)}`;
}

function freshness(snapshot?: ProviderSnapshot) {
  if (!snapshot) return "未取得";
  const diff = Date.now() - new Date(snapshot.collectedAt).getTime();
  const minutes = Math.max(0, Math.round(diff / 60000));
  if (minutes < 1) return "たった今";
  if (minutes < 60) return `${minutes}分前`;
  return `${Math.round(minutes / 60)}時間前`;
}

function status(snapshot?: ProviderSnapshot) {
  if (!snapshot) return "waiting";
  const worst = Math.max(...snapshot.metrics.map((metric) => metric.usedPercentage ?? 0));
  if (worst >= 90) return "blocked";
  if (worst >= 70) return "watch";
  return "ok";
}

function statusColor(currentStatus: ReturnType<typeof status>) {
  if (currentStatus === "blocked") return "#ef4444";
  if (currentStatus === "watch") return "#facc15";
  if (currentStatus === "ok") return "#22c55e";
  return "#6b7280";
}

function statusTitle(currentStatus: ReturnType<typeof status>) {
  if (currentStatus === "blocked") return "90%以上使用済み";
  if (currentStatus === "watch") return "70%以上使用済み";
  if (currentStatus === "ok") return "70%未満";
  return "未取得";
}

function openUsageUrl(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

function providerSectionId(providerId: ProviderId) {
  return `provider-detail-${providerId}`;
}

function formatReset(resetAt?: string) {
  if (!resetAt) return "リセット時刻を確認中";
  if (/^\d{10}$/.test(resetAt)) {
    return new Date(Number(resetAt) * 1000).toLocaleString("ja-JP", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return resetAt;
}

function isUsageStore(value: unknown): value is UsageStore {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (!("providers" in record)) return false;
  return typeof record.providers === "object" && record.providers !== null;
}

function toUsageStore(value: unknown): UsageStore {
  if (isUsageStore(value)) return value;
  return { updatedAt: null, providers: {} };
}

function storeUpdatedAtMs(store: UsageStore) {
  if (!store.updatedAt) return 0;
  const ms = new Date(store.updatedAt).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function pickNewerStore(current: UsageStore, incoming: UsageStore) {
  return storeUpdatedAtMs(incoming) >= storeUpdatedAtMs(current) ? incoming : current;
}

export default function Home() {
  const [store, setStore] = useState<UsageStore>({ updatedAt: null, providers: {} });
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const [providerOrder, setProviderOrder] = useState<ProviderId[]>(providers.map((provider) => provider.id));
  const [draggingProvider, setDraggingProvider] = useState<ProviderId | null>(null);
  const [, setStreamStatus] = useState<"connecting" | "live" | "offline">("connecting");

  async function refresh() {
    const response = await fetch("/api/ingest", { cache: "no-store" });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error((payload as { error?: string } | null)?.error ?? "refresh failed");
    }
    const incoming = toUsageStore(payload);
    setStore((current) => pickNewerStore(current, incoming));
    setLoading(false);
  }

  useEffect(() => {
    function onUnhandledRejection(event: PromiseRejectionEvent) {
      const reason = event.reason as { message?: string; stack?: string } | string | undefined;
      const message = String((typeof reason === "string" ? reason : reason?.message) ?? "");
      if (!message.includes("A listener indicated an asynchronous response by returning true")) return;
    }

    window.addEventListener("unhandledrejection", onUnhandledRejection);

    const events = new EventSource("/api/events");
    events.addEventListener("open", () => {
      setStreamStatus("live");
      setLoading(false);
    });
    events.addEventListener("usage", (message) => {
      const payload = JSON.parse((message as MessageEvent<string>).data);
      const incoming = toUsageStore(payload);
      setStore((current) => pickNewerStore(current, incoming));
      setStreamStatus("live");
      setLoading(false);
    });
    events.addEventListener("error", () => {
      setStreamStatus("offline");
      void refresh();
    });
    return () => {
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
      events.close();
    };
  }, []);

  useEffect(() => {
    function onCollectorMessage(event: MessageEvent) {
      if (event.source !== window) return;
      if (event.data?.source !== "AI_USAGE_COLLECTOR_EXTENSION") return;

      if (event.data.type === "AI_USAGE_BRIDGE_READY") {
        return;
      }
      if (event.data.type === "AI_USAGE_STORE_SYNC" && event.data.store) {
        const incoming = toUsageStore(event.data.store);
        setStore((current) => pickNewerStore(current, incoming));
        setLoading(false);
      }
    }

    window.addEventListener("message", onCollectorMessage);
    return () => window.removeEventListener("message", onCollectorMessage);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      void refresh();
    }, 5000);
    return () => window.clearInterval(id);
  }, []);

  function scrollToProviderDetail(providerId: ProviderId) {
    const target = document.getElementById(providerSectionId(providerId));
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function reorderProviders(fromId: ProviderId, toId: ProviderId) {
    if (fromId === toId) return;
    setProviderOrder((current) => {
      const fromIndex = current.indexOf(fromId);
      const toIndex = current.indexOf(toId);
      if (fromIndex < 0 || toIndex < 0) return current;
      const next = [...current];
      next.splice(fromIndex, 1);
      next.splice(toIndex, 0, fromId);
      return next;
    });
  }

  async function handleManualRefresh() {
    const startedAt = Date.now();
    setIsRefreshing(true);
    setRefreshMessage("更新中... データを取得しています");
    try {
      await refresh();
      const elapsed = Date.now() - startedAt;
      if (elapsed < 800) {
        await new Promise((resolve) => window.setTimeout(resolve, 800 - elapsed));
      }
      setRefreshMessage(`更新完了: ${new Date().toLocaleTimeString("ja-JP")}`);
    } catch {
      setRefreshMessage("更新に失敗しました。しばらく待って再試行してください。");
    } finally {
      setIsRefreshing(false);
      window.setTimeout(() => {
        setRefreshMessage((prev) =>
          prev?.startsWith("更新完了") || prev?.startsWith("更新に失敗") ? null : prev
        );
      }, 2500);
    }
  }

  const orderedProviders = providerOrder
    .map((providerId) => providers.find((provider) => provider.id === providerId))
    .filter((provider): provider is (typeof providers)[number] => Boolean(provider));

  const snapshots = orderedProviders.map((provider) => ({
    config: provider,
    snapshot: store.providers[provider.id],
  }));

  const metricEntries = snapshots.flatMap(({ config, snapshot }) =>
    (snapshot?.metrics ?? []).map((metric) => ({
      providerName: config.name,
      metric,
    }))
  );
  const alertMetricEntries = [...metricEntries]
    .filter((entry) => (entry.metric.usedPercentage ?? 0) >= 70)
    .sort((a, b) => (b.metric.usedPercentage ?? 0) - (a.metric.usedPercentage ?? 0));
  return (
    <main className="min-h-screen bg-[#11120f] text-[#f3f0e8]">
      <section className="mx-auto flex w-full max-w-7xl flex-col gap-7 px-5 py-6 sm:px-8 lg:px-10">
        <header className="flex flex-col gap-5 border-b border-[#303027] pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <h1 className="text-4xl font-semibold tracking-normal text-[#fffaf0] sm:text-6xl">
              AI 使用量メーター
            </h1>
          </div>
          <div className="grid gap-3 sm:grid-cols-1 lg:w-[520px]">
            <div className="rounded-md border border-[#343428] bg-[#191a15] p-3">
              <div className="flex items-center gap-2 text-xs text-[#a8a18f]">
                <AlertCircle size={18} />
                70%以上の項目
              </div>
              <div className="mt-2 space-y-1">
                {alertMetricEntries.length > 0 ? (
                  alertMetricEntries.map((entry) => (
                    <p key={`${entry.providerName}-${entry.metric.id}`} className="text-base font-semibold text-[#fffaf0]">
                      {entry.providerName} - {metricLabelJa(entry.metric.label)} ({entry.metric.usedPercentage}%)
                    </p>
                  ))
                ) : (
                  <p className="text-base font-semibold text-[#fffaf0]">該当なし</p>
                )}
              </div>
            </div>
          </div>
        </header>

        <section className="grid gap-4">
          <div className="rounded-md border border-[#343428] bg-[#191a15] p-5">
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-[#fffaf0]">使用状況サマリー</h2>
                <p className="mt-1 text-sm leading-6 text-[#a8a18f]">
                  いま最も使用率が高い項目を優先的に把握するためのサマリーです。<br />
                  カードはドラッグで並び替えでき、下の詳細セクションにも順序が連動します。
                </p>
              </div>
              <button
                onClick={handleManualRefresh}
                disabled={isRefreshing}
                className="inline-flex h-10 items-center gap-2 self-start rounded-md bg-[#e6c06f] px-3 text-sm font-semibold text-[#17140d] transition hover:bg-[#f1d18d] disabled:cursor-not-allowed disabled:opacity-70"
              >
                <RefreshCcw size={16} className={isRefreshing ? "animate-spin" : ""} />
                {isRefreshing ? "更新中..." : "更新"}
              </button>
            </div>
            {refreshMessage ? <p className="mb-4 text-xs text-[#a8a18f]">{refreshMessage}</p> : null}
            <div className="grid gap-3 md:grid-cols-3">
              {snapshots.map(({ config, snapshot }) => (
                <ProviderCard
                  key={config.id}
                  config={config}
                  snapshot={snapshot}
                  onClick={() => scrollToProviderDetail(config.id)}
                  draggable
                  onDragStart={() => setDraggingProvider(config.id)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => {
                    if (!draggingProvider) return;
                    reorderProviders(draggingProvider, config.id);
                    setDraggingProvider(null);
                  }}
                  onDragEnd={() => setDraggingProvider(null)}
                />
              ))}
            </div>
          </div>

        </section>

        <section className="grid gap-4 xl:grid-cols-3">
          {snapshots.map(({ config, snapshot }) => (
            <section
              key={config.id}
              id={providerSectionId(config.id)}
              className="scroll-mt-6 rounded-md border border-[#343428] bg-[#181914] p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-semibold" style={{ color: config.accent }}>
                    {config.name}
                  </h2>
                </div>
                <p className="mt-1 flex items-center gap-2 text-sm text-[#a8a18f]">
                  <Clock3 size={15} />
                  最終取得: {freshness(snapshot)}
                </p>
              </div>

              <div className="mt-5 space-y-3">
                {snapshot?.metrics.length ? (
                  snapshot.metrics.map((metric) => (
                    <MetricRow key={metric.id} metric={metric} color={config.accent} />
                  ))
                ) : (
                  <div className="rounded-md border border-dashed border-[#3c3c31] bg-[#202119] p-4 text-sm leading-6 text-[#a8a18f]">
                    {snapshot
                      ? snapshot.diagnostic ?? "Collectorは動きましたが、使用量を検出できませんでした。"
                      : "まだCollectorから値が届いていません。対象ページを開くと自動でPOSTされます。"}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => openUsageUrl(config.url)}
                className="mt-2 block w-full truncate text-left text-xs text-[#a29a86] underline decoration-[#5a5140] underline-offset-4 transition hover:text-[#e6c06f]"
                title={config.url}
              >
                Usage URL: {config.url}
              </button>
            </section>
          ))}
        </section>
      </section>
    </main>
  );
}

function ProviderCard({
  config,
  snapshot,
  onClick,
  draggable,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  config: (typeof providers)[number];
  snapshot?: ProviderSnapshot;
  onClick?: () => void;
  draggable?: boolean;
  onDragStart?: () => void;
  onDragOver?: (event: React.DragEvent<HTMLElement>) => void;
  onDrop?: () => void;
  onDragEnd?: () => void;
}) {
  const currentStatus = status(snapshot);
  const worst = snapshot?.metrics
    ? [...snapshot.metrics].sort((a, b) => (b.usedPercentage ?? 0) - (a.usedPercentage ?? 0))[0]
    : null;

  return (
    <article
      className="rounded-md border border-[#343428] bg-[#202119] p-4 transition hover:border-[#4a493d] hover:bg-[#24251e] cursor-pointer"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick?.();
        }
      }}
      aria-label={`${config.name}の詳細へ移動`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className="grid size-10 place-items-center rounded-md"
            style={{ backgroundColor: `${config.accent}20`, color: config.accent }}
          >
            {config.id === "cursor" ? <Code2 size={20} /> : config.id === "claude" ? <Bot size={20} /> : <TerminalSquare size={20} />}
          </div>
          <div>
            <h3 className="font-semibold text-[#fffaf0]">{config.name}</h3>
            <p className="text-xs text-[#a8a18f]">{config.collector}</p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span
            className="grid size-4 place-items-center rounded-full"
            title={statusTitle(currentStatus)}
            aria-label={statusTitle(currentStatus)}
            style={{
              backgroundColor: `${statusColor(currentStatus)}24`,
              boxShadow: `0 0 0 1px ${statusColor(currentStatus)}55`,
            }}
          >
            <span
              className="size-2 rounded-full"
              style={{
                backgroundColor: statusColor(currentStatus),
                boxShadow: `0 0 12px ${statusColor(currentStatus)}`,
              }}
            />
          </span>
          <p className="flex items-center gap-1 text-xs text-[#aaa38f]">
            <Clock3 size={13} /> {freshness(snapshot)}
          </p>
        </div>
      </div>
      <div className="mt-4">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-[#b6ae9b]">{worst ? metricLabelJa(worst.label) : "データなし"}</span>
          <strong className="text-2xl text-[#fffaf0]">{worst ? usedLabel(worst) : "-"}</strong>
        </div>
        <Meter value={worst?.usedPercentage ?? 0} color={config.accent} />
      </div>
    </article>
  );
}

function MetricRow({ metric, color }: { metric: UsageMetric; color: string }) {
  return (
    <div className="rounded-md border border-[#303027] bg-[#202119] p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-[#fffaf0]">
            {metricLabelJa(metric.label)}
            <span className="ml-2 text-xs font-normal text-[#9f9785]">
              {metricSubline(metric)}
            </span>
          </p>
        </div>
        <strong className="text-lg text-[#fffaf0]">{usedLabel(metric)}</strong>
      </div>
      {metric.usedPercentage == null ? null : <Meter value={metric.usedPercentage} color={color} />}
      {metric.detail && metric.usedPercentage != null ? <p className="mt-2 text-xs leading-5 text-[#8f8876]">{metric.detail}</p> : null}
    </div>
  );
}

function Meter({ value, color }: { value: number; color: string }) {
  return (
    <div className="mt-3 h-2 rounded-full bg-[#343428]">
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${Math.max(0, Math.min(100, value))}%`, backgroundColor: color }}
      />
    </div>
  );
}
