import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = new Set(["https://kahe1374.github.io"]);
const corsHeaders = (origin: string | null) => ({
  ...(origin && allowedOrigins.has(origin) ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin" } : {}),
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
});

const reply = (status: number, body: Record<string, unknown>, origin: string | null) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders(origin) });

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (origin && !allowedOrigins.has(origin)) return new Response("origin_not_allowed", { status: 403 });
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (req.method !== "POST") return reply(405, { error: "method_not_allowed" }, origin);

  try {
    const raw = await req.text();
    if (raw.length > 12000) return reply(413, { error: "request_too_large" }, origin);
    const body = JSON.parse(raw);

    // Honeypot: bots that fill this hidden field are silently rejected.
    if (typeof body.website === "string" && body.website.trim()) {
      return reply(200, { ok: true }, origin);
    }

    const name = String(body.name ?? "").trim().slice(0, 160);
    const mobile = String(body.phone ?? "").replace(/[\s-]/g, "");
    const type = String(body.type ?? "").trim().slice(0, 30);
    const city = String(body.city ?? "").trim().slice(0, 100);
    const details = String(body.details ?? "").trim().slice(0, 3000);

    if (name.length < 2 || !/^(09\d{9}|\+989\d{9}|00989\d{9})$/.test(mobile) || !type) {
      return reply(400, { error: "invalid_form" }, origin);
    }

    const url = Deno.env.get("SUPABASE_URL");
    // Prefer the modern secret API key; fall back to the legacy service-role key.
    const secretKeysRaw = Deno.env.get("SUPABASE_SECRET_KEYS");
    let secretKey: string | undefined;
    if (secretKeysRaw) {
      try {
        const secretKeys = JSON.parse(secretKeysRaw);
        secretKey = secretKeys.default;
      } catch {
        console.error("invalid_secret_keys_environment");
      }
    }
    const key = secretKey ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return reply(503, { error: "backend_not_configured" }, origin);

    const db = createClient(url, key, { auth: { persistSession: false } });
    const normalizedMobile = mobile.startsWith("09") ? "+98" + mobile.slice(1) :
      mobile.startsWith("0098") ? "+" + mobile.slice(2) : mobile;

    const { data: customer, error: customerError } = await db
      .from("customers")
      .insert({ full_name: name, mobile: normalizedMobile, city, notes: "درخواست ثبت‌شده از سایت NOVA CABINET" })
      .select("id")
      .single();

    if (customerError || !customer) {
      console.error("customer_insert_failed", customerError?.message);
      return reply(500, { error: "save_failed" }, origin);
    }

    const orderNumber = "NV-" + crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
    const { error: orderError } = await db.from("orders").insert({
      order_number: orderNumber,
      customer_id: customer.id,
      order_type: "cabinet",
      title: type,
      description: [city ? "شهر: " + city : "", details].filter(Boolean).join("\n"),
      status: "new",
    });

    if (orderError) {
      console.error("order_insert_failed", orderError.message);
      // Keep no orphaned customer record if order creation fails.
      await db.from("customers").delete().eq("id", customer.id);
      return reply(500, { error: "save_failed" }, origin);
    }

    return reply(201, { ok: true, order_number: orderNumber }, origin);
  } catch (error) {
    console.error("create_lead_error", error instanceof Error ? error.message : "unknown");
    return reply(400, { error: "invalid_request" }, origin);
  }
});
