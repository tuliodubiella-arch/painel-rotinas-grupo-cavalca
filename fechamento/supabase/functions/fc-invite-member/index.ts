import { createClient } from "npm:@supabase/supabase-js@2";

const projectUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const publishableKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const pagesOrigin = "https://tuliodubiella-arch.github.io";
const redirectTo = `${pagesOrigin}/painel-rotinas-grupo-cavalca/fechamento/`;

function response(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": pagesOrigin,
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" },
  });
}

Deno.serve(async (request) => {
  if (request.headers.get("origin") !== pagesOrigin) return response({ error: "Origem não permitida" }, 403);
  if (request.method === "OPTIONS") return response({ ok: true });
  if (request.method !== "POST") return response({ error: "Método inválido" }, 405);
  const jwt = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!jwt) return response({ error: "Sessão necessária" }, 401);
  const authClient = createClient(projectUrl, publishableKey, { auth: { persistSession: false } });
  const adminClient = createClient(projectUrl, serviceKey, { auth: { persistSession: false } });
  const { data: identity, error: identityError } = await authClient.auth.getUser(jwt);
  if (identityError || !identity.user) return response({ error: "Sessão inválida" }, 401);
  const { data: caller, error: callerError } = await adminClient.from("fc_members")
    .select("is_admin,active").eq("id", identity.user.id).maybeSingle();
  if (callerError || !caller?.active || !caller?.is_admin) return response({ error: "Somente o administrador pode convidar" }, 403);

  let payload: { email?: string; name?: string };
  try { payload = await request.json(); } catch { return response({ error: "Dados inválidos" }, 400); }
  const email = payload.email?.trim().toLowerCase();
  const name = payload.name?.trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !name || name.length < 2 || name.length > 120)
    return response({ error: "Informe nome e e-mail válidos" }, 400);
  const { data: existing } = await adminClient.from("fc_members").select("id").eq("email", email).maybeSingle();
  if (existing) return response({ error: "Este e-mail já está cadastrado no fechamento" }, 409);

  let userId: string | undefined;
  let existingUser = false;
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) return response({ error: "Não foi possível conferir os usuários existentes" }, 500);
    const match = data.users.find((user) => user.email?.toLowerCase() === email);
    if (match) { userId = match.id; existingUser = true; break; }
    if (data.users.length < 1000) break;
  }
  if (!userId) {
    const { data: invite, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, { redirectTo, data: { full_name: name } });
    if (inviteError || !invite.user) return response({ error: inviteError?.message || "Convite não enviado" }, 400);
    userId = invite.user.id;
  }
  const { error: insertError } = await adminClient.from("fc_members").insert({ id: userId, email, name, legacy_name: name, active: true, is_admin: false });
  if (insertError) return response({ error: "O perfil não foi criado. Verifique o cadastro no Supabase." }, 500);
  await adminClient.from("fc_tasks").update({ responsible_id: userId, responsible_legacy_name: null })
    .ilike("responsible_legacy_name", name);
  return response({ ok: true, existingUser });
});

