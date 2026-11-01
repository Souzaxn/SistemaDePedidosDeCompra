import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import { createClient } from "jsr:@supabase/supabase-js@2.49.8";

const app = new Hono();
const P = "/make-server-e3b494b7";

const adminClient = () =>
  createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

const userClient = (authHeader: string) =>
  createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: authHeader } },
    },
  );

app.use("*", logger(console.log));
app.use(
  "/*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
  }),
);

// ── helpers ──────────────────────────────────────────────────────────────────

const getUser = async (authHeader: string | undefined) => {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  const { data, error } = await adminClient().auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
};

const getProfile = async (userId: string) => {
  const { data } = await adminClient()
    .from("profiles_tecar")
    .select("*")
    .eq("id", userId)
    .single();
  return data as { id: string; name: string; email: string; is_admin: boolean } | null;
};

const requireAuth = async (authHeader: string | undefined) => {
  const user = await getUser(authHeader);
  if (!user) return { user: null, profile: null, error: "Unauthorized" };
  const profile = await getProfile(user.id);
  return { user, profile, error: null };
};

const requireAdmin = async (authHeader: string | undefined) => {
  const auth = await requireAuth(authHeader);
  if (auth.error || !auth.user || !auth.profile?.is_admin) {
    return { ...auth, error: "Acesso restrito ao administrador." };
  }
  return auth;
};

const BACKUP_BUCKET = "tecar-backups";
const BACKUP_TABLES = [
  "profiles_tecar",
  "suppliers_tecar",
  "itens",
  "estoque",
  "estoque_importacoes",
  "purchase_orders_tecar",
  "notas_fiscais_avulsas_tecar",
  "order_sequence_tecar",
  "order_drafts_tecar",
] as const;

const readAllRows = async (table: string) => {
  const client = adminClient();
  const rows: unknown[] = [];
  const pageSize = 250;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await client
      .from(table)
      .select("*")
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
};

const ensureBackupBucket = async () => {
  const client = adminClient();
  const { data } = await client.storage.getBucket(BACKUP_BUCKET);
  if (!data) {
    const { error } = await client.storage.createBucket(BACKUP_BUCKET, { public: false });
    if (error) throw error;
  }
};

const createBackup = async (reason: string) => {
  await ensureBackupBucket();
  const tables: Record<string, unknown[]> = {};
  for (const table of BACKUP_TABLES) tables[table] = await readAllRows(table);
  const createdAt = new Date().toISOString();
  const body = JSON.stringify({ version: 1, created_at: createdAt, reason, tables });
  const name = `${createdAt.replace(/[:.]/g, "-")}-${reason}.json`;
  const client = adminClient();
  const { error } = await client.storage
    .from(BACKUP_BUCKET)
    .upload(name, new Blob([body], { type: "application/json" }), { upsert: false });
  if (error) throw error;

  const cutoff = Date.now() - 30 * 86_400_000;
  const { data: files } = await client.storage.from(BACKUP_BUCKET).list("", {
    limit: 1000,
    sortBy: { column: "created_at", order: "desc" },
  });
  const expired = (files ?? [])
    .filter((file) => new Date(file.created_at ?? 0).getTime() < cutoff)
    .map((file) => file.name);
  if (expired.length) await client.storage.from(BACKUP_BUCKET).remove(expired);
  await client.from("backup_cron_tecar").update({
    last_success_at: createdAt,
    last_error: null,
  }).eq("id", 1);
  return { name, created_at: createdAt, size: new Blob([body]).size };
};

const recordBackupFailure = async (caught: unknown) => {
  await adminClient().from("backup_cron_tecar").update({
    last_failure_at: new Date().toISOString(),
    last_error: String(caught).slice(0, 1000),
  }).eq("id", 1);
};

// ── health ────────────────────────────────────────────────────────────────────

app.get(`${P}/health`, (c) => c.json({ status: "ok" }));

// ── backups ──────────────────────────────────────────────────────────────────

app.get(`${P}/backups`, async (c) => {
  const { error } = await requireAdmin(c.req.header("Authorization"));
  if (error) return c.json({ error }, 403);
  await ensureBackupBucket();
  const { data, error: storageError } = await adminClient().storage
    .from(BACKUP_BUCKET)
    .list("", { limit: 1000, sortBy: { column: "created_at", order: "desc" } });
  if (storageError) return c.json({ error: storageError.message }, 500);
  const { data: status } = await adminClient().from("backup_cron_tecar")
    .select("last_success_at,last_failure_at,last_error").eq("id", 1).maybeSingle();
  return c.json({
    backups: (data ?? []).map((file) => ({
      name: file.name,
      created_at: file.created_at,
      size: file.metadata?.size ?? 0,
    })),
    status,
  });
});

app.post(`${P}/backups`, async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const auth = await requireAuth(c.req.header("Authorization"));
    if (auth.error || !auth.user || (!auth.profile?.is_admin && body.reason !== "before-stock-import")) {
      return c.json({ error: "Acesso restrito." }, 403);
    }
    return c.json({ backup: await createBackup(body.reason || "manual") });
  } catch (caught) {
    await recordBackupFailure(caught);
    return c.json({ error: String(caught) }, 500);
  }
});

app.post(`${P}/backups/scheduled`, async (c) => {
  const { data: cron } = await adminClient().from("backup_cron_tecar")
    .select("token").eq("id", 1).maybeSingle();
  if (!cron?.token || c.req.header("X-Cron-Token") !== cron.token) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  try {
    return c.json({ backup: await createBackup("daily") });
  } catch (caught) {
    await recordBackupFailure(caught);
    return c.json({ error: String(caught) }, 500);
  }
});

app.get(`${P}/backups/:name/download`, async (c) => {
  const { error } = await requireAdmin(c.req.header("Authorization"));
  if (error) return c.json({ error }, 403);
  const { data, error: signedError } = await adminClient().storage
    .from(BACKUP_BUCKET)
    .createSignedUrl(c.req.param("name"), 60);
  if (signedError) return c.json({ error: signedError.message }, 500);
  return c.json({ url: data.signedUrl });
});

app.post(`${P}/backups/:name/restore`, async (c) => {
  const { error } = await requireAdmin(c.req.header("Authorization"));
  if (error) return c.json({ error }, 403);
  const dbUrl = Deno.env.get("SUPABASE_DB_URL");
  if (!dbUrl) return c.json({ error: "SUPABASE_DB_URL não configurada." }, 500);
  try {
    await createBackup("before-restore");
    const { data, error: downloadError } = await adminClient().storage
      .from(BACKUP_BUCKET)
      .download(c.req.param("name"));
    if (downloadError) throw downloadError;
    const backup = JSON.parse(await data.text()) as {
      tables: Record<string, Array<Record<string, unknown>>>;
    };
    const { default: postgres } = await import("npm:postgres");
    const sql = postgres(dbUrl, { ssl: "require", max: 1 });
    await sql.begin(async (transaction) => {
      await transaction`TRUNCATE order_drafts_tecar, notas_fiscais_avulsas_tecar, purchase_orders_tecar, estoque_importacoes, estoque, itens, suppliers_tecar, profiles_tecar, order_sequence_tecar CASCADE`;
      for (const table of BACKUP_TABLES) {
        const rows = backup.tables[table] ?? [];
        for (let start = 0; start < rows.length; start += 500) {
          const batch = rows.slice(start, start + 500);
          if (batch.length) await transaction`INSERT INTO ${transaction(table)} ${transaction(batch)}`;
        }
      }
    });
    await sql.end();
    return c.json({ success: true });
  } catch (caught) {
    return c.json({ error: String(caught) }, 500);
  }
});

// ── setup ─────────────────────────────────────────────────────────────────────

app.post(`${P}/setup`, async (c) => {
  const dbUrl = Deno.env.get("SUPABASE_DB_URL");
  if (!dbUrl) return c.json({ error: "SUPABASE_DB_URL not set" }, 500);

  try {
    const { default: postgres } = await import("npm:postgres");
    const sql = postgres(dbUrl, { ssl: "require", max: 1 });

    await sql`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`;

    await sql`
      CREATE TABLE IF NOT EXISTS profiles_tecar (
        id UUID PRIMARY KEY,
        name TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL DEFAULT '',
        is_admin BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS suppliers_tecar (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name TEXT NOT NULL,
        cnpj TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS itens (
        codigo TEXT PRIMARY KEY,
        descricao TEXT NOT NULL DEFAULT '',
        valor NUMERIC(14,2) NOT NULL DEFAULT 0
      )
    `;
    await sql`ALTER TABLE itens ENABLE ROW LEVEL SECURITY`;
    await sql`
      DO $$ BEGIN
        CREATE POLICY "itens_select" ON itens FOR SELECT
          USING (auth.role() = 'authenticated');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `;
    await sql`
      DO $$ BEGIN
        CREATE POLICY "itens_insert" ON itens FOR INSERT
          WITH CHECK (auth.role() = 'authenticated');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `;
    await sql`
      DO $$ BEGIN
        CREATE POLICY "itens_update" ON itens FOR UPDATE
          USING (auth.role() = 'authenticated')
          WITH CHECK (auth.role() = 'authenticated');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `;
    await sql`GRANT SELECT, INSERT, UPDATE ON itens TO authenticated`;

    await sql`
      CREATE TABLE IF NOT EXISTS order_sequence_tecar (
        id INT PRIMARY KEY DEFAULT 1,
        last_number INT NOT NULL DEFAULT 0
      )
    `;

    await sql`INSERT INTO order_sequence_tecar (id, last_number) VALUES (1, 0) ON CONFLICT DO NOTHING`;

    await sql`
      CREATE TABLE IF NOT EXISTS purchase_orders_tecar (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        order_number INT NOT NULL UNIQUE,
        supplier_id UUID,
        supplier_name TEXT NOT NULL,
        supplier_cnpj TEXT NOT NULL,
        created_by UUID NOT NULL,
        created_by_name TEXT NOT NULL,
        issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        items JSONB NOT NULL DEFAULT '[]',
        total NUMERIC(14,2) NOT NULL DEFAULT 0,
        notes TEXT DEFAULT '',
        excluido_em TIMESTAMPTZ,
        excluido_por TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await sql`
      ALTER TABLE purchase_orders_tecar
      ADD COLUMN IF NOT EXISTS excluido_em TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS excluido_por TEXT
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS purchase_orders_tecar_order_number_idx
      ON purchase_orders_tecar (order_number DESC)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS purchase_orders_tecar_issued_at_idx
      ON purchase_orders_tecar (issued_at)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS purchase_orders_tecar_created_by_name_idx
      ON purchase_orders_tecar (created_by_name)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS purchase_orders_tecar_excluido_em_idx
      ON purchase_orders_tecar (excluido_em)
    `;

    await sql.end();

    // Create admin user
    const supabase = adminClient();
    const ADMIN_EMAIL = "admim@tecar.com.br";
    const ADMIN_PASSWORD = "Tecar@123";

    const { data: listData } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const adminExists = listData?.users?.some((u) => u.email === ADMIN_EMAIL);

    if (!adminExists) {
      const { data: created } = await supabase.auth.admin.createUser({
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: "Admin Tecar" },
      });
      if (created?.user) {
        await supabase.from("profiles_tecar").upsert({
          id: created.user.id,
          name: "Admin Tecar",
          email: ADMIN_EMAIL,
          is_admin: true,
        });
      }
    } else {
      const adminUser = listData!.users.find((u) => u.email === ADMIN_EMAIL)!;
      await supabase.from("profiles_tecar").upsert({
        id: adminUser.id,
        name: "Admin Tecar",
        email: ADMIN_EMAIL,
        is_admin: true,
      });
    }

    return c.json({ success: true });
  } catch (err) {
    console.error("Setup error:", err);
    return c.json({ error: String(err) }, 500);
  }
});

// ── profile ───────────────────────────────────────────────────────────────────

app.post(`${P}/profile`, async (c) => {
  const { user, error } = await requireAuth(c.req.header("Authorization"));
  if (error || !user) return c.json({ error }, 401);
  const body = await c.req.json();
  const supabase = adminClient();
  await supabase.from("profiles_tecar").upsert({
    id: user.id,
    name: body.name || user.user_metadata?.full_name || user.email?.split("@")[0] || "Usuário",
    email: user.email || "",
    is_admin: false,
  });
  const profile = await getProfile(user.id);
  return c.json({ profile });
});

app.get(`${P}/profile/me`, async (c) => {
  const { user, profile, error } = await requireAuth(c.req.header("Authorization"));
  if (error || !user) return c.json({ error }, 401);
  return c.json({ profile });
});

// ── suppliers ─────────────────────────────────────────────────────────────────

app.get(`${P}/suppliers`, async (c) => {
  const { error } = await requireAuth(c.req.header("Authorization"));
  if (error) return c.json({ error }, 401);
  const q = c.req.query("q") || "";
  const supabase = adminClient();
  let query = supabase.from("suppliers_tecar").select("*").order("name");
  if (q) query = query.ilike("name", `%${q}%`);
  const { data, error: dbError } = await query;
  if (dbError) return c.json({ error: dbError.message }, 500);
  return c.json({ suppliers: data });
});

app.post(`${P}/suppliers`, async (c) => {
  const { error } = await requireAuth(c.req.header("Authorization"));
  if (error) return c.json({ error }, 401);
  const body = await c.req.json();
  const { data, error: dbError } = await adminClient()
    .from("suppliers_tecar")
    .insert({ name: body.name, cnpj: body.cnpj })
    .select()
    .single();
  if (dbError) return c.json({ error: dbError.message }, 400);
  return c.json({ supplier: data });
});

app.put(`${P}/suppliers/:id`, async (c) => {
  const { error } = await requireAuth(c.req.header("Authorization"));
  if (error) return c.json({ error }, 401);
  const body = await c.req.json();
  const { data, error: dbError } = await adminClient()
    .from("suppliers_tecar")
    .update({ name: body.name, cnpj: body.cnpj, updated_at: new Date().toISOString() })
    .eq("id", c.req.param("id"))
    .select()
    .single();
  if (dbError) return c.json({ error: dbError.message }, 400);
  return c.json({ supplier: data });
});

// ── orders ────────────────────────────────────────────────────────────────────

app.get(`${P}/orders`, async (c) => {
  const { error } = await requireAuth(c.req.header("Authorization"));
  if (error) return c.json({ error }, 401);
  const supabase = adminClient();
  let query = supabase
    .from("purchase_orders_tecar")
    .select("id,order_number,supplier_name,supplier_cnpj,created_by,created_by_name,issued_at,total,notes,created_at")
    .is("excluido_em", null)
    .order("order_number", { ascending: false });

  const supplier = c.req.query("supplier");
  const number = c.req.query("number");
  const dateFrom = c.req.query("dateFrom");
  const dateTo = c.req.query("dateTo");

  if (supplier) query = query.ilike("supplier_name", `%${supplier}%`);
  if (number) query = query.eq("order_number", parseInt(number));
  if (dateFrom) query = query.gte("issued_at", dateFrom);
  if (dateTo) query = query.lte("issued_at", dateTo + "T23:59:59Z");

  const { data, error: dbError } = await query;
  if (dbError) return c.json({ error: dbError.message }, 500);
  return c.json({ orders: data });
});

app.get(`${P}/orders/:id`, async (c) => {
  const { error } = await requireAuth(c.req.header("Authorization"));
  if (error) return c.json({ error }, 401);
  const { data, error: dbError } = await adminClient()
    .from("purchase_orders_tecar")
    .select("*")
    .eq("id", c.req.param("id"))
    .is("excluido_em", null)
    .single();
  if (dbError) return c.json({ error: dbError.message }, 404);
  return c.json({ order: data });
});

app.post(`${P}/orders`, async (c) => {
  const { user, profile, error } = await requireAuth(c.req.header("Authorization"));
  if (error || !user || !profile) return c.json({ error }, 401);

  const dbUrl = Deno.env.get("SUPABASE_DB_URL");
  if (!dbUrl) return c.json({ error: "SUPABASE_DB_URL not set" }, 500);

  const body = await c.req.json();
  const creatorName =
    profile.name?.trim() ||
    profile.email?.trim() ||
    user.email ||
    "";
  if (!creatorName) return c.json({ error: "Não foi possível identificar o criador do pedido." }, 400);
  let orderNumber: number;

  try {
    const { default: postgres } = await import("npm:postgres");
    const sql = postgres(dbUrl, { ssl: "require", max: 1 });
    const result = await sql`
      UPDATE order_sequence_tecar SET last_number = last_number + 1 WHERE id = 1 RETURNING last_number
    `;
    orderNumber = result[0].last_number;
    await sql.end();
  } catch (err) {
    return c.json({ error: "Failed to get order number: " + String(err) }, 500);
  }

  const { data, error: dbError } = await adminClient()
    .from("purchase_orders_tecar")
    .insert({
      order_number: orderNumber,
      supplier_id: body.supplier_id || null,
      supplier_name: body.supplier_name,
      supplier_cnpj: body.supplier_cnpj,
      created_by: user.id,
      created_by_name: creatorName,
      issued_at: new Date().toISOString(),
      items: body.items,
      total: body.total,
      notes: body.notes || "",
    })
    .select()
    .single();

  if (dbError) return c.json({ error: dbError.message }, 400);
  return c.json({ order: data });
});

app.put(`${P}/orders/:id`, async (c) => {
  const { user, profile, error } = await requireAuth(c.req.header("Authorization"));
  if (error || !user || !profile) return c.json({ error }, 401);

  const supabase = adminClient();
  const { data: existing } = await supabase
    .from("purchase_orders_tecar")
    .select("created_by")
    .eq("id", c.req.param("id"))
    .is("excluido_em", null)
    .single();

  if (!existing) return c.json({ error: "Order not found" }, 404);
  if (existing.created_by !== user.id && !profile.is_admin) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const body = await c.req.json();
  const { data, error: dbError } = await supabase
    .from("purchase_orders_tecar")
    .update({
      supplier_id: body.supplier_id || null,
      supplier_name: body.supplier_name,
      supplier_cnpj: body.supplier_cnpj,
      items: body.items,
      total: body.total,
      notes: body.notes || "",
      updated_at: new Date().toISOString(),
    })
    .eq("id", c.req.param("id"))
    .is("excluido_em", null)
    .select()
    .single();

  if (dbError) return c.json({ error: dbError.message }, 400);
  return c.json({ order: data });
});

app.delete(`${P}/orders/:id`, async (c) => {
  const authHeader = c.req.header("Authorization");
  const { error } = await requireAuth(authHeader);
  if (error || !authHeader) return c.json({ error }, 401);
  const { error: dbError } = await userClient(authHeader).rpc(
    "mover_pedido_lixeira_tecar",
    { p_pedido_id: c.req.param("id") },
  );

  if (dbError) return c.json({ error: dbError.message }, 400);
  return c.json({ success: true });
});

Deno.serve(app.fetch);
