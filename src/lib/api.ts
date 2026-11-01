import { supabase } from "./supabase";
import { SERVER_URL } from "./supabase";
import {
  InventoryItem,
  normalizeItemCode,
  StockImport,
  StockItem,
} from "./items";
import { validateStandaloneInvoice } from "./invoices";

// ── Helpers ───────────────────────────────────────────────────────────────────

const uid = async () => {
  const { data } = await supabase.auth.getUser();
  return data.user?.id;
};

// ── Profile ───────────────────────────────────────────────────────────────────

export const profileApi = {
  getById: async (id: string) => {
    const { data, error } = await supabase
      .from("profiles_tecar")
      .select("id,name,email,is_admin")
      .eq("id", id)
      .maybeSingle();
    if (error) return null;
    return data;
  },

  upsert: async (name: string, email: string) => {
    const id = await uid();
    if (!id) return null;
    const { data, error } = await supabase
      .from("profiles_tecar")
      .upsert({ id, name, email })
      .select()
      .single();
    if (error) return null;
    return data;
  },

  me: async () => {
    const id = await uid();
    if (!id) return null;
    const { data } = await supabase
      .from("profiles_tecar")
      .select("*")
      .eq("id", id)
      .single();
    return data;
  },
};

// ── Suppliers ─────────────────────────────────────────────────────────────────

export const suppliersApi = {
  list: async (q?: string) => {
    let query = supabase.from("suppliers_tecar").select("*").order("name");
    if (q?.trim()) query = query.ilike("name", `%${q.trim()}%`);
    const { data, error } = await query;
    if (error) throw error;
    return data ?? [];
  },

  paged: async (params?: { search?: string; page?: number; pageSize?: number }) => {
    const page = Math.max(1, params?.page ?? 1);
    const pageSize = Math.max(1, params?.pageSize ?? 10);
    const { data, error } = await supabase.rpc("buscar_fornecedores_tecar", {
      p_busca: params?.search?.trim() ?? "",
      p_limite: pageSize,
      p_deslocamento: (page - 1) * pageSize,
    });
    if (error) throw error;
    const rows = (data ?? []) as Array<Record<string, any> & { total_count: number | string }>;
    return {
      suppliers: rows.map(({ total_count: _count, ...supplier }) => supplier),
      total: rows.length ? Number(rows[0].total_count) : 0,
    };
  },

  create: async (name: string, cnpj: string, phone = "", email = "") => {
    const { data, error } = await supabase
      .from("suppliers_tecar")
      .insert({ name, cnpj, phone, email, created_by: await uid() })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  update: async (id: string, name: string, cnpj: string, phone = "", email = "") => {
    const { data, error } = await supabase
      .from("suppliers_tecar")
      .update({ name, cnpj, phone, email, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  delete: async (id: string) => {
    const { count, error: countError } = await supabase
      .from("purchase_orders_tecar")
      .select("id", { count: "exact", head: true })
      .eq("supplier_id", id);
    if (countError) throw countError;
    if (count) throw new Error("Este fornecedor tem pedidos vinculados e não pode ser excluído");
    const { error } = await supabase.from("suppliers_tecar").delete().eq("id", id);
    if (error) throw error;
  },
};

// ── Inventory items ───────────────────────────────────────────────────────────

const ITEM_BATCH_SIZE = 250;
const MAX_BATCH_ATTEMPTS = 3;

type SupabaseResult = {
  error: any;
  status?: number;
  statusText?: string;
};

const wait = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const errorText = (error: any) => {
  if (!error) return "Erro não informado pelo servidor.";
  return [
    error.message,
    error.details,
    error.hint,
    error.code ? `código ${error.code}` : "",
  ]
    .filter(Boolean)
    .join(" | ");
};

const isRetryable = (result: SupabaseResult) => {
  const status = result.status ?? 0;
  const message = errorText(result.error).toLocaleLowerCase("pt-BR");
  return (
    status === 0 ||
    status === 408 ||
    status === 429 ||
    status >= 500 ||
    /failed to fetch|network|rede|timeout|tempo limite|aborted|econn/.test(message)
  );
};

const batchRequest = async <T extends SupabaseResult>(
  operation: () => PromiseLike<T>,
  stage: string,
) => {
  let lastResult: T | null = null;
  for (let attempt = 1; attempt <= MAX_BATCH_ATTEMPTS; attempt += 1) {
    let result: T;
    try {
      result = await operation();
    } catch (caught) {
      result = {
        error: caught,
        status: 0,
        statusText: "",
      } as T;
    }
    if (!result.error) return result;
    lastResult = result;
    if (!isRetryable(result) || attempt === MAX_BATCH_ATTEMPTS) break;
    await wait(attempt * 1000);
  }

  const status = lastResult?.status
    ? `${lastResult.status}${lastResult.statusText ? ` ${lastResult.statusText}` : ""}`
    : "indisponível (falha de rede antes de receber resposta)";
  throw new Error(
    `${stage}. Status HTTP: ${status}. Erro retornado: ${errorText(lastResult?.error)}`,
  );
};

export const itemsApi = {
  findByCode: async (code: string): Promise<InventoryItem | null> => {
    const codigo = normalizeItemCode(code);
    if (!codigo) return null;
    const { data, error } = await supabase
      .from("itens")
      .select("codigo,descricao,valor")
      .eq("codigo", codigo)
      .maybeSingle();
    if (error) throw error;
    return data
      ? { ...data, valor: Number(data.valor) }
      : null;
  },

  insertMissing: async (items: InventoryItem[]) => {
    if (!items.length) return;
    for (let start = 0; start < items.length; start += ITEM_BATCH_SIZE) {
      const batch = items.slice(start, start + ITEM_BATCH_SIZE);
      const { error } = await supabase
        .from("itens")
        .upsert(batch, { onConflict: "codigo", ignoreDuplicates: true });
      if (error) throw error;
    }
  },

  import: async (
    items: InventoryItem[],
    onProgress?: (batch: number, totalBatches: number) => void,
  ) => {
    let created = 0;
    let updated = 0;
    const totalBatches = Math.ceil(items.length / ITEM_BATCH_SIZE);

    for (let start = 0; start < items.length; start += ITEM_BATCH_SIZE) {
      const batch = items.slice(start, start + ITEM_BATCH_SIZE);
      const batchNumber = Math.floor(start / ITEM_BATCH_SIZE) + 1;
      const codes = batch.map((item) => item.codigo);
      const { data: existing } = await batchRequest(
        () => supabase.from("itens").select("codigo").in("codigo", codes),
        `Falha na verificação do lote ${batchNumber} de ${totalBatches} de itens`,
      );

      const existingCodes = new Set((existing ?? []).map((item) => item.codigo));
      updated += batch.filter((item) => existingCodes.has(item.codigo)).length;
      created += batch.length - existingCodes.size;

      await batchRequest(
        () => supabase.from("itens").upsert(batch, { onConflict: "codigo" }),
        `Falha na gravação do lote ${batchNumber} de ${totalBatches} de itens`,
      );
      onProgress?.(batchNumber, totalBatches);
    }

    return { created, updated };
  },
};

// ── Current stock ─────────────────────────────────────────────────────────────

export const stockApi = {
  import: async (
    items: StockItem[],
    importedByName: string,
    onProgress?: (batch: number, totalBatches: number) => void,
  ) => {
    let created = 0;
    let updated = 0;
    const totalBatches = Math.ceil(items.length / ITEM_BATCH_SIZE);

    for (let start = 0; start < items.length; start += ITEM_BATCH_SIZE) {
      const batch = items.slice(start, start + ITEM_BATCH_SIZE);
      const batchNumber = Math.floor(start / ITEM_BATCH_SIZE) + 1;
      const codes = [...new Set(batch.map((item) => item.codigo))];
      const existing: Array<{ codigo: string; locacao: string }> = [];
      const existingPageSize = ITEM_BATCH_SIZE;

      for (let offset = 0; ; offset += existingPageSize) {
        const { data } = await batchRequest(
          () =>
            supabase
              .from("estoque")
              .select("codigo,locacao")
              .in("codigo", codes)
              .order("codigo")
              .order("locacao")
              .range(offset, offset + existingPageSize - 1),
          `Falha na verificação do lote ${batchNumber} de ${totalBatches} do estoque`,
        );
        existing.push(...(data ?? []));
        if (!data || data.length < existingPageSize) break;
      }

      const existingKeys = new Set(
        existing.map((item) => `${item.codigo}\u0000${item.locacao}`),
      );
      const updatedInBatch = batch.filter((item) =>
        existingKeys.has(`${item.codigo}\u0000${item.locacao}`),
      ).length;
      updated += updatedInBatch;
      created += batch.length - updatedInBatch;

      await batchRequest(
        () =>
          supabase
            .from("estoque")
            .upsert(batch, { onConflict: "codigo,locacao" }),
        `Falha na gravação do lote ${batchNumber} de ${totalBatches} do estoque`,
      );
      onProgress?.(batchNumber, totalBatches);
    }

    if (!items.length) onProgress?.(0, 0);

    const importedBy = await uid();
    if (!importedBy) throw new Error("Usuário não autenticado.");
    const { data } = await batchRequest(
      () =>
        supabase
          .from("estoque_importacoes")
          .insert({
            imported_by: importedBy,
            imported_by_name: importedByName,
            line_count: items.length,
          })
          .select("id,imported_at,imported_by,imported_by_name,line_count")
          .single(),
      "Falha ao registrar a conclusão da importação",
    );

    const { count } = await batchRequest(
      () => supabase.from("estoque").select("codigo", { count: "exact", head: true }),
      "Falha ao contar o estoque após a importação",
    );

    return {
      importRecord: data as StockImport,
      created,
      updated,
      total: count ?? 0,
    };
  },

  latestImport: async (): Promise<StockImport | null> => {
    const { data, error } = await supabase
      .from("estoque_importacoes")
      .select("id,imported_at,imported_by,imported_by_name,line_count")
      .order("imported_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data as StockImport | null;
  },

  list: async (params?: {
    code?: string;
    description?: string;
    location?: string;
    sort?: "code" | "location" | "description";
    direction?: "asc" | "desc";
    page?: number;
    pageSize?: number;
  }) => {
    const page = Math.max(1, params?.page ?? 1);
    const pageSize = Math.max(1, params?.pageSize ?? 10);
    const { data, error } = await supabase.rpc("buscar_estoque_tecar", {
      p_codigo: params?.code?.trim() ?? "",
      p_descricao: params?.description?.trim() ?? "",
      p_locacao: params?.location?.trim() ?? "",
      p_ordenacao: params?.sort ?? "code",
      p_direcao: params?.direction ?? "asc",
      p_limite: pageSize,
      p_deslocamento: (page - 1) * pageSize,
    });
    if (error) throw error;

    const rows = (data ?? []) as Array<
      StockItem & { total_count: number | string }
    >;
    return {
      items: rows.map(({ total_count: _totalCount, ...item }) => ({
        ...item,
        custo_contabil: Number(item.custo_contabil),
        custo_fornecedor: Number(item.custo_fornecedor),
      })),
      total: rows.length ? Number(rows[0].total_count) : 0,
    };
  },
};

// ── Drafts ────────────────────────────────────────────────────────────────────

export const draftsApi = {
  getMine: async () => {
    const id = await uid();
    if (!id) return null;
    const { data, error } = await supabase
      .from("order_drafts_tecar")
      .select("payload,updated_at")
      .eq("user_id", id)
      .maybeSingle();
    if (error) throw error;
    return data as { payload: Record<string, any>; updated_at: string } | null;
  },

  saveMine: async (payload: Record<string, unknown>) => {
    const id = await uid();
    if (!id) throw new Error("Usuário não autenticado.");
    const { data, error } = await supabase
      .from("order_drafts_tecar")
      .upsert({ user_id: id, payload, updated_at: new Date().toISOString() })
      .select("updated_at")
      .single();
    if (error) throw error;
    return data as { updated_at: string };
  },

  deleteMine: async () => {
    const id = await uid();
    if (!id) return;
    const { error } = await supabase.from("order_drafts_tecar").delete().eq("user_id", id);
    if (error) throw error;
  },
};

const serverRequest = async (path: string, init?: RequestInit) => {
  const { data } = await supabase.auth.getSession();
  let response: Response;
  try {
    response = await fetch(`${SERVER_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${data.session?.access_token ?? ""}`,
        ...init?.headers,
      },
    });
  } catch (caught) {
    throw new Error(
      `Status HTTP: indisponível (falha de rede antes de receber resposta). Erro retornado: ${
        caught instanceof Error ? caught.message : String(caught)
      }`,
    );
  }
  const responseText = await response.text();
  let result: any = {};
  try {
    result = responseText ? JSON.parse(responseText) : {};
  } catch {
    result = {};
  }
  if (!response.ok) {
    throw new Error(
      `Status HTTP: ${response.status} ${response.statusText}. Erro retornado: ${
        result.error || responseText || "resposta vazia"
      }`,
    );
  }
  return result;
};

export const backupsApi = {
  list: async () => serverRequest("/backups"),
  create: async (reason = "manual") =>
    (await serverRequest("/backups", {
      method: "POST",
      body: JSON.stringify({ reason }),
    })).backup,
  download: async (name: string) =>
    (await serverRequest(`/backups/${encodeURIComponent(name)}/download`)).url as string,
  restore: async (name: string) =>
    serverRequest(`/backups/${encodeURIComponent(name)}/restore`, { method: "POST" }),
};

// ── Invoice checking ──────────────────────────────────────────────────────────

export interface InvoiceOrder {
  id: string;
  note_type: "order" | "standalone";
  order_number: number | null;
  supplier_name: string;
  supplier_cnpj: string;
  issued_on: string | null;
  total: number | null;
  nota_numero: string;
  nota_conferida: boolean;
  nota_conferida_por: string | null;
  nota_conferida_em: string | null;
}

export const notesApi = {
  list: async (params?: {
    status?: "pending" | "completed" | "all";
    search?: string;
    page?: number;
    pageSize?: number;
  }) => {
    const page = Math.max(1, params?.page ?? 1);
    const pageSize = Math.max(1, params?.pageSize ?? 10);
    const { data, error } = await supabase.rpc("listar_notas_unificadas_tecar", {
      p_status: params?.status ?? "pending",
      p_busca: params?.search?.trim() ?? "",
      p_limite: pageSize,
      p_deslocamento: (page - 1) * pageSize,
    });
    if (error) throw error;
    const rows = (data ?? []) as Array<InvoiceOrder & { total_count: number | string }>;
    return {
      notes: rows.map(({ total_count: _totalCount, ...note }) => ({
        ...note,
        total: note.total == null ? null : Number(note.total),
      })),
      total: rows.length ? Number(rows[0].total_count) : 0,
    };
  },

  pendingCount: async () => {
    const { data, error } = await supabase.rpc("listar_notas_unificadas_tecar", {
      p_status: "pending",
      p_busca: "",
      p_limite: 1,
      p_deslocamento: 0,
    });
    if (error) throw error;
    return data?.length ? Number(data[0].total_count) : 0;
  },

  createStandalone: async (payload: {
    nota_numero: string;
    supplier_id: string;
    total: number | null;
  }) => {
    const number = payload.nota_numero.trim();
    const validation = validateStandaloneInvoice(number, payload.supplier_id);
    if (validation.number) throw new Error(validation.number);
    if (validation.supplier) throw new Error(validation.supplier);
    const { data, error } = await supabase.rpc("criar_nota_avulsa_tecar", {
      p_nota_numero: number,
      p_supplier_id: payload.supplier_id,
      p_total: payload.total,
    });
    if (error) throw error;
    return data as string;
  },

  saveNumber: async (orderId: string, number: string) => {
    const { data, error } = await supabase.rpc("salvar_nota_pedido_tecar", {
      p_pedido_id: orderId,
      p_nota_numero: number.trim(),
    });
    if (error) throw error;
    return (data?.[0] ?? null) as {
      nota_numero: string | null;
      nota_conferida: boolean;
      nota_conferida_por: string | null;
      nota_conferida_em: string | null;
      duplicate_order_number: number | null;
    } | null;
  },

  setChecked: async (
    noteId: string,
    checked: boolean,
    noteType: "order" | "standalone" = "order",
  ) => {
    const { data, error } = noteType === "standalone"
      ? await supabase.rpc("conferir_nota_avulsa_tecar", {
        p_nota_id: noteId,
        p_conferida: checked,
      })
      : await supabase.rpc("conferir_nota_pedido_tecar", {
        p_pedido_id: noteId,
        p_conferida: checked,
      });
    if (error) throw error;
    return data?.[0] ?? null;
  },

  getStandalone: async (id: string) => {
    const { data, error } = await supabase
      .from("notas_fiscais_avulsas_tecar")
      .select("*, supplier:suppliers_tecar(name,cnpj)")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const supplier = data.supplier as unknown as { name: string; cnpj: string };
    return {
      ...data,
      note_type: "standalone" as const,
      supplier_name: supplier.name,
      supplier_cnpj: supplier.cnpj,
    };
  },

  findDuplicate: async (
    number: string,
    supplier: { id?: string; cnpj: string },
    excludeOrderId?: string,
  ) => {
    const trimmed = number.trim();
    if (!trimmed) return null;
    let query = supabase
      .from("purchase_orders_tecar")
      .select("id,order_number")
      .ilike("nota_numero", trimmed)
      .is("excluido_em", null)
      .limit(1);
    if (supplier.id) query = query.eq("supplier_id", supplier.id);
    else query = query.eq("supplier_cnpj", supplier.cnpj);
    if (excludeOrderId) query = query.neq("id", excludeOrderId);
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    return data as { id: string; order_number: number } | null;
  },
};

// ── Orders ────────────────────────────────────────────────────────────────────

const withCreatorNames = async <T extends {
  created_by?: string | null;
  created_by_name?: string | null;
}>(orders: T[]) => {
  const missingIds = [...new Set(
    orders
      .filter((order) => !order.created_by_name?.trim() && order.created_by)
      .map((order) => order.created_by as string),
  )];
  let profiles = new Map<string, string>();
  if (missingIds.length) {
    const { data } = await supabase
      .from("profiles_tecar")
      .select("id,name,email")
      .in("id", missingIds);
    profiles = new Map(
      (data ?? []).map((profile) => [
        profile.id,
        String(profile.name || "").trim() || String(profile.email || "").trim(),
      ]),
    );
  }
  return orders.map((order) => ({
    ...order,
    created_by_name:
      order.created_by_name?.trim() ||
      (order.created_by ? profiles.get(order.created_by) : "") ||
      "Não identificado",
  }));
};

export const ordersApi = {
  list: async (params?: {
    supplier?: string;
    number?: string;
    dateFrom?: string;
    dateTo?: string;
    page?: number;
    pageSize?: number;
  }) => {
    const page = Math.max(1, params?.page ?? 1);
    const pageSize = Math.max(1, params?.pageSize ?? 10);
    const offset = (page - 1) * pageSize;
    let query = supabase
      .from("purchase_orders_tecar")
      .select(
        "id,order_number,supplier_name,supplier_cnpj,created_by,created_by_name,issued_at,total,notes,created_at",
        { count: "exact" },
      )
      .is("excluido_em", null)
      .order("order_number", { ascending: false });

    if (params?.supplier) query = query.ilike("supplier_name", `%${params.supplier}%`);
    if (params?.number) query = query.eq("order_number", parseInt(params.number));
    if (params?.dateFrom) query = query.gte("issued_at", params.dateFrom);
    if (params?.dateTo) query = query.lte("issued_at", params.dateTo + "T23:59:59Z");

    const { data, error, count } = await query.range(offset, offset + pageSize - 1);
    if (error) throw error;
    return { orders: await withCreatorNames(data ?? []), total: count ?? 0 };
  },

  get: async (id: string) => {
    const { data, error } = await supabase
      .from("purchase_orders_tecar")
      .select("*")
      .eq("id", id)
      .is("excluido_em", null)
      .single();
    if (error) throw error;
    return (await withCreatorNames([data]))[0];
  },

  create: async (payload: {
    supplier_id?: string;
    supplier_name: string;
    supplier_cnpj: string;
    items: unknown[];
    total: number;
    notes?: string;
    nota_numero?: string;
  }) => {
    if (!payload.nota_numero?.trim()) {
      throw new Error("Informe o número da nota");
    }
    // Atomic order number via PostgreSQL function
    const { data: numData, error: numError } = await supabase.rpc("next_order_number_tecar");
    if (numError) throw new Error("Falha ao gerar número do pedido: " + numError.message);

    const { data: userData, error: userError } = await supabase.auth.getUser();
    const user = userData.user;
    if (userError || !user) throw new Error("Usuário autenticado não identificado.");
    const creatorProfile = await profileApi.getById(user.id);
    const creatorName =
      String(creatorProfile?.name || "").trim() ||
      String(creatorProfile?.email || "").trim() ||
      user.email ||
      "";
    if (!creatorName) throw new Error("Não foi possível identificar o criador do pedido.");
    const { data, error } = await supabase
      .from("purchase_orders_tecar")
      .insert({
        order_number: numData,
        supplier_id: payload.supplier_id || null,
        supplier_name: payload.supplier_name,
        supplier_cnpj: payload.supplier_cnpj,
        created_by: user.id,
        created_by_name: creatorName,
        issued_at: new Date().toISOString(),
        items: payload.items,
        total: payload.total,
        notes: payload.notes || "",
        nota_numero: payload.nota_numero?.trim() || null,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  update: async (
    id: string,
    payload: {
      supplier_id?: string;
      supplier_name: string;
      supplier_cnpj: string;
      items: unknown[];
      total: number;
      notes?: string;
      nota_numero?: string;
      update_note?: boolean;
    },
  ) => {
    const { data, error } = await supabase
      .from("purchase_orders_tecar")
      .update({
        supplier_id: payload.supplier_id || null,
        supplier_name: payload.supplier_name,
        supplier_cnpj: payload.supplier_cnpj,
        items: payload.items,
        total: payload.total,
        notes: payload.notes || "",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .is("excluido_em", null)
      .select()
      .single();
    if (error) throw error;
    if (!payload.update_note) return data;
    const note = await notesApi.saveNumber(id, payload.nota_numero ?? "");
    return { ...data, ...note };
  },

  moveToTrash: async (id: string) => {
    const { error } = await supabase.rpc("mover_pedido_lixeira_tecar", {
      p_pedido_id: id,
    });
    if (error) throw error;
  },

  restore: async (id: string) => {
    const { error } = await supabase.rpc("restaurar_pedido_lixeira_tecar", {
      p_pedido_id: id,
    });
    if (error) throw error;
  },

  permanentlyDelete: async (id: string) => {
    const { error } = await supabase.rpc("excluir_pedido_definitivamente_tecar", {
      p_pedido_id: id,
    });
    if (error) throw error;
  },

  trash: async (page = 1, pageSize = 10) => {
    const { data, error } = await supabase.rpc("listar_lixeira_tecar", {
      p_limite: pageSize,
      p_deslocamento: (Math.max(1, page) - 1) * pageSize,
    });
    if (error) throw error;
    const rows = (data ?? []) as Array<Record<string, any> & { total_count: number | string }>;
    return {
      orders: rows.map(({ total_count: _totalCount, ...order }) => order),
      total: rows.length ? Number(rows[0].total_count) : 0,
    };
  },

  trashCount: async () => {
    const { data, error } = await supabase.rpc("contar_lixeira_tecar");
    if (error) throw error;
    return Number(data ?? 0);
  },

  // Check if tables exist
  checkSetup: async (): Promise<boolean> => {
    const [orders, items, stock, imports, drafts, suppliers, normalization, notes, trash] = await Promise.all([
      supabase.from("purchase_orders_tecar").select("id,nota_numero,nota_conferida,nota_conferida_por,nota_conferida_em,excluido_em,excluido_por").limit(1),
      supabase.from("itens").select("codigo").limit(1),
      supabase.from("estoque").select("codigo").limit(1),
      supabase.from("estoque_importacoes").select("id").limit(1),
      supabase.from("order_drafts_tecar").select("user_id").limit(1),
      supabase.from("suppliers_tecar").select("phone,email,created_by").limit(1),
      supabase.rpc("normalizar_texto_tecar", { valor: "Ação" }),
      supabase.rpc("listar_notas_unificadas_tecar", {
        p_status: "pending",
        p_busca: "",
        p_limite: 1,
        p_deslocamento: 0,
      }),
      supabase.rpc("contar_lixeira_tecar"),
    ]);
    return !orders.error && !items.error && !stock.error && !imports.error &&
      !drafts.error && !suppliers.error && !normalization.error && !notes.error && !trash.error &&
      normalization.data === "acao";
  },
};
