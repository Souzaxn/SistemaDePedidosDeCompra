import { supabase } from "./supabase";

export const TECAR_REALTIME_EVENT = "tecar:realtime-change";

export const realtimeTables = [
  "purchase_orders_tecar",
  "notas_fiscais_avulsas_tecar",
  "suppliers_tecar",
  "itens",
  "estoque",
  "estoque_importacoes",
] as const;

export type RealtimeTable = (typeof realtimeTables)[number];

export interface TecarRealtimeDetail {
  table: RealtimeTable | "*";
  eventType: "INSERT" | "UPDATE" | "DELETE" | "REFRESH";
  recordId?: string;
}

const pendingChanges = new Map<RealtimeTable, TecarRealtimeDetail>();
const localMutations = new Map<string, number>();
let dispatchTimer: number | undefined;

const dispatchChange = (detail: TecarRealtimeDetail) => {
  window.dispatchEvent(new CustomEvent<TecarRealtimeDetail>(TECAR_REALTIME_EVENT, {
    detail,
  }));
};

const queueChange = (detail: TecarRealtimeDetail & { table: RealtimeTable }) => {
  pendingChanges.set(detail.table, detail);
  window.clearTimeout(dispatchTimer);
  dispatchTimer = window.setTimeout(() => {
    const changes = [...pendingChanges.values()];
    pendingChanges.clear();
    changes.forEach(dispatchChange);
  }, 180);
};

export const markLocalRealtimeMutation = (table: RealtimeTable, recordId: string) => {
  const now = Date.now();
  localMutations.forEach((expiresAt, key) => {
    if (expiresAt <= now) localMutations.delete(key);
  });
  localMutations.set(`${table}:${recordId}`, now + 5_000);
};

const consumeLocalMutation = (table: RealtimeTable, recordId?: string) => {
  if (!recordId) return false;
  const key = `${table}:${recordId}`;
  const expiresAt = localMutations.get(key) ?? 0;
  localMutations.delete(key);
  return expiresAt > Date.now();
};

export const startTecarRealtime = () => {
  let channel: ReturnType<typeof supabase.channel> | null = null;
  let subscribed = false;
  let hiddenAt = 0;
  let stopped = false;

  const subscribe = async () => {
    if (channel) await supabase.removeChannel(channel);
    if (stopped) return;

    subscribed = false;
    const nextChannel = supabase.channel(`tecar-live-${Date.now()}`);
    realtimeTables.forEach((table) => {
      nextChannel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        (payload) => {
          const record = payload.eventType === "DELETE" ? payload.old : payload.new;
          const recordId = typeof record?.id === "string"
            ? record.id
            : typeof record?.codigo === "string"
              ? record.codigo
              : undefined;
          if (consumeLocalMutation(table, recordId)) return;
          queueChange({
            table,
            eventType: payload.eventType,
            recordId,
          });
        },
      );
    });
    channel = nextChannel;
    nextChannel.subscribe((status) => {
      if (channel === nextChannel) subscribed = status === "SUBSCRIBED";
    });
  };

  const handleVisibility = () => {
    if (document.visibilityState === "hidden") {
      hiddenAt = Date.now();
      return;
    }
    if (hiddenAt && Date.now() - hiddenAt >= 60_000) {
      dispatchChange({ table: "*", eventType: "REFRESH" });
      void subscribe();
    }
    hiddenAt = 0;
  };

  void subscribe();
  document.addEventListener("visibilitychange", handleVisibility);
  const fallbackTimer = window.setInterval(() => {
    if (!subscribed && document.visibilityState === "visible") {
      dispatchChange({ table: "*", eventType: "REFRESH" });
    }
  }, 30_000);

  return () => {
    stopped = true;
    document.removeEventListener("visibilitychange", handleVisibility);
    window.clearInterval(fallbackTimer);
    window.clearTimeout(dispatchTimer);
    pendingChanges.clear();
    localMutations.clear();
    if (channel) void supabase.removeChannel(channel);
  };
};
