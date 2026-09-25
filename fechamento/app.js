/* Interface pública; os dados e permissões ficam no Supabase sob RLS. */
const SUPABASE_URL = "https://ppjgzgtlfdoumcgrczjb.supabase.co";
const SUPABASE_KEY = "sb_publishable_tfKt4b51swHhI5gqNIJ0DA_jEpkPDwB";
const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const $ = (selector) => document.querySelector(selector);
const field = (form, name) => form.elements.namedItem(name);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const uid = () => crypto.randomUUID();
const departments = ["financeiro", "rh", "estoque", "fiscal"];
const tabNames = ["Painel", "Execução", "Metas", "Histórico", "Cadastros"];
const legacyCutoff = "2026-09";
const initialInvite = new URLSearchParams(location.hash.replace(/^#/, "")).get("type") === "invite";
const state = {
  session: null, member: null, members: [], companies: [], tasks: [], targets: [], receipts: [],
  states: [], holidays: [], history: [], tab: "Painel", month: "2026-09", query: "",
  companyFilter: "", ownerFilter: "", statusFilter: "", online: navigator.onLine,
  queue: [], ready: false, needsPassword: initialInvite, tick: Date.now(), error: "",
};
let flushing = false;
let toastTimer;

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove("show"), 4500);
}
function brasilia(iso) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "medium" }).format(new Date(iso));
}
function dateBR(iso) { return iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—"; }
function monthName(month) { return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(`${month}-01T00:00:00Z`)); }
function duration(seconds) {
  const n = Math.max(0, Math.floor(seconds || 0));
  return [Math.floor(n / 3600), Math.floor(n % 3600 / 60), n % 60].map((part) => String(part).padStart(2, "0")).join(":");
}
function currentSeconds(item) {
  if (!item) return 0;
  return (item.total_seconds || 0) + (item.status === "Em andamento" && item.started_at ? Math.max(0, Math.floor((state.tick - Date.parse(item.started_at)) / 1000)) : 0);
}
function easter(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  return new Date(Date.UTC(year, Math.floor((h + l - 7 * m + 114) / 31) - 1, ((h + l - 7 * m + 114) % 31) + 1));
}
function holidayDates(year) {
  const fixed = ["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "11-20", "12-25", "11-14"];
  const goodFriday = new Date(easter(year).getTime() - 2 * 86400000).toISOString().slice(0, 10);
  const dates = new Set([...fixed.map((day) => `${year}-${day}`), goodFriday]);
  if (year === 2026) dates.add("2026-06-04"); // Corpus Christi, Cascavel/PR, Decreto 20.042/2025.
  for (const holiday of state.holidays) dates.add(holiday.date);
  return dates;
}
function plannedDate(month, businessDay) {
  if (!businessDay || businessDay < 1 || businessDay > 23) return null;
  const [year, monthNumber] = month.split("-").map(Number);
  const next = new Date(Date.UTC(year, monthNumber, 1));
  const excluded = holidayDates(next.getUTCFullYear());
  let count = 0;
  for (let date = new Date(next); date.getUTCMonth() === next.getUTCMonth(); date.setUTCDate(date.getUTCDate() + 1)) {
    const iso = date.toISOString().slice(0, 10);
    if ([0, 6].includes(date.getUTCDay()) || excluded.has(iso)) continue;
    if (++count === businessDay) return iso;
  }
  return null;
}
function validCnpj(value) {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 14 || /^(\d)\1+$/.test(digits)) return false;
  for (const length of [12, 13]) {
    const weights = length === 12 ? [5,4,3,2,9,8,7,6,5,4,3,2] : [6,5,4,3,2,9,8,7,6,5,4,3,2];
    const sum = weights.reduce((total, weight, index) => total + Number(digits[index]) * weight, 0);
    if ((sum % 11 < 2 ? 0 : 11 - sum % 11) !== Number(digits[length])) return false;
  }
  return true;
}
const cacheKey = () => `fc_cache_${state.session?.user?.id || "anonymous"}`;
const queueKey = () => `fc_queue_${state.session?.user?.id || "anonymous"}`;
function saveCache() {
  if (!state.session) return;
  const payload = Object.fromEntries(["members", "companies", "tasks", "targets", "receipts", "states", "holidays", "history"].map((key) => [key, state[key]]));
  localStorage.setItem(cacheKey(), JSON.stringify(payload));
}
function loadCache() {
  try {
    const data = JSON.parse(localStorage.getItem(cacheKey()) || "null");
    if (data) for (const key of Object.keys(data)) if (key in state) state[key] = data[key];
    state.queue = JSON.parse(localStorage.getItem(queueKey()) || "[]");
    state.member = state.members.find((person) => person.id === state.session?.user?.id && person.active) || null;
    state.ready = Boolean(data);
  } catch { /* Sem cache legível neste aparelho. */ }
}
function enqueue(item) {
  state.queue.push(item);
  localStorage.setItem(queueKey(), JSON.stringify(state.queue));
  saveCache(); render();
  toast(state.online ? "Registro salvo; sincronizando…" : "Registro salvo neste aparelho; sincronizará quando voltar a conexão.");
  void flush();
}
async function flush() {
  if (!state.online || !state.member || flushing) return;
  flushing = true;
  try {
    while (state.queue.length) {
      const item = state.queue[0];
      let result;
      if (item.kind === "rpc") result = await client.rpc(item.name, item.args);
      else if (item.kind === "upsert") result = await client.from(item.table).upsert(item.row, { onConflict: item.conflict });
      else if (item.kind === "update") {
        let query = client.from(item.table).update(item.values);
        for (const [key, value] of Object.entries(item.where)) query = query.eq(key, value);
        result = await query.select();
      }
      if (result?.error) throw result.error;
      state.queue.shift();
      localStorage.setItem(queueKey(), JSON.stringify(state.queue));
    }
    await loadData();
  } catch (error) { toast(`Sincronização pendente: ${error.message || error}`); }
  finally { flushing = false; render(); }
}
async function allRows(table) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client.from(table).select("*").range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}
async function loadData() {
  if (!state.session || !state.online) { render(); return; }
  try {
    const [members, companies, tasks, targets, receipts, activityStates, holidays, history] = await Promise.all([
      allRows("fc_members"), allRows("fc_companies"), allRows("fc_tasks"), allRows("fc_targets"),
      allRows("fc_receipts"), allRows("fc_activity_states"), allRows("fc_holidays"), allRows("fc_history_tasks"),
    ]);
    state.members = members; state.companies = companies; state.tasks = tasks; state.targets = targets;
    state.receipts = receipts; state.states = activityStates; state.holidays = holidays; state.history = history;
    state.member = members.find((person) => person.id === state.session.user.id && person.active) || null;
    state.error = state.member ? "" : "Seu acesso ao fechamento ainda não foi liberado pelo administrador.";
    state.ready = true; saveCache(); render();
  } catch (error) {
    state.error = `Não foi possível carregar os dados: ${error.message || error}. Se a migração ainda não foi aplicada, aguarde a configuração.`;
    state.ready = true; render();
  }
}
function monthOptions() {
  const list = [];
  for (let year = 2026; year <= 2027; year++) for (let month = 1; month <= 12; month++) list.push(`${year}-${String(month).padStart(2, "0")}`);
  return list.map((month) => `<option value="${month}" ${month === state.month ? "selected" : ""}>${esc(monthName(month))}</option>`).join("");
}
function memberName(id, legacy) { return state.members.find((item) => item.id === id)?.name || legacy || "A definir"; }
function companyName(id) { return state.companies.find((item) => item.id === id)?.name || "Empresa não encontrada"; }
function taskState(id) { return state.states.find((item) => item.task_id === id && item.competence === state.month); }
function targetFor(company) {
  return state.targets.find((item) => item.company_id === company.id && item.competence === state.month)
    || { company_id: company.id, competence: state.month, category: company.category, sort_order: 9999, business_day: null, planned_date: null, delivery_at: null };
}
function receiptFor(companyId, department) {
  return state.receipts.find((item) => item.company_id === companyId && item.competence === state.month && item.department === department);
}
function isHistorical() { return state.month < legacyCutoff; }
function monthlyTasks() {
  if (isHistorical()) return state.history.filter((item) => item.competence === state.month).map((item) => ({ ...item, company_name: item.company, owner_name: item.owner_name, historic: true }));
  return state.tasks.filter((item) => item.active).map((item) => ({ ...item, company_name: companyName(item.company_id), owner_name: memberName(item.responsible_id, item.responsible_legacy_name) }));
}
function statusOf(task) { return task.historic ? task.status || "Não iniciado" : taskState(task.id)?.status || "Não iniciado"; }
function badge(status) {
  const tone = status === "Finalizado" || status === "Concluída" ? "done" : status === "Em andamento" ? "running" : status === "Pausado" ? "paused" : "";
  return `<span class="badge ${tone}">${esc(status)}</span>`;
}
function renderAuth() {
  const passwordForm = state.needsPassword && state.session;
  $("#app").innerHTML = `<div class="auth-screen"><div class="auth-box"><div class="brand"><small>Grupo Cavalca</small><strong>Fechamento contábil</strong></div>
    <h1 style="font-size:23px;margin-top:22px">${passwordForm ? "Defina sua senha" : "Acesse o painel"}</h1>
    <p>${passwordForm ? "No primeiro acesso, escolha uma senha exclusiva para sua conta." : "Entre com o e-mail cadastrado pelo administrador."}</p>
    <form id="auth-form">${passwordForm ? "" : '<label class="field"><span>E-mail</span><input class="input" name="email" type="email" autocomplete="email" required></label>'}
    <label class="field"><span>${passwordForm ? "Nova senha" : "Senha"}</span><input class="input" name="password" type="password" minlength="8" autocomplete="${passwordForm ? "new-password" : "current-password"}" required></label>
    ${passwordForm ? '<label class="field"><span>Confirmar senha</span><input class="input" name="confirm" type="password" minlength="8" autocomplete="new-password" required></label>' : ""}
    <button class="btn primary" type="submit">${passwordForm ? "Definir senha" : "Entrar"}</button></form>
    ${passwordForm ? "" : '<button class="btn" style="margin-top:12px;width:100%" data-action="forgot-password">Esqueci minha senha</button>'}
    <p id="auth-error" style="color:#b91c1c;margin-top:12px"></p></div></div>`;
}
function renderPanel() {
  const items = monthlyTasks();
  const completed = items.filter((item) => ["Finalizado", "Concluída"].includes(statusOf(item))).length;
  const running = items.filter((item) => statusOf(item) === "Em andamento").length;
  const seconds = isHistorical() ? 0 : state.states.filter((item) => item.competence === state.month).reduce((sum, item) => sum + currentSeconds(item), 0);
  const received = state.receipts.filter((item) => item.competence === state.month && item.status === "Recebido").length;
  const slowest = isHistorical() ? [] : items.map((item) => ({ ...item, seconds: currentSeconds(taskState(item.id)) })).filter((item) => item.seconds > 0).sort((a, b) => b.seconds - a.seconds).slice(0, 8);
  return `<div class="grid cards"><div class="card"><span>Atividades</span><strong>${items.length}</strong><small>${completed} finalizadas</small></div>
    <div class="card"><span>Em andamento</span><strong>${running}</strong><small>Rotinas em execução</small></div>
    <div class="card"><span>Tempo registrado</span><strong class="live-total">${isHistorical() ? "—" : duration(seconds)}</strong><small>Soma das conciliações</small></div>
    <div class="card"><span>Documentos recebidos</span><strong>${received}</strong><small>Financeiro, RH, Estoque e Fiscal</small></div></div>
    <div class="two-col"><section class="panel"><div class="panel-head"><div><h2>Progresso das empresas</h2><p>Atividades finalizadas no mês</p></div></div><div class="panel-body">
    ${state.companies.filter((item) => item.active).map((company) => { const companyTasks = items.filter((item) => item.company_id === company.id); const done = companyTasks.filter((item) => ["Finalizado", "Concluída"].includes(statusOf(item))).length; return `<div class="slow-row"><span>${esc(company.name)}</span><strong>${done}/${companyTasks.length}</strong></div>`; }).join("")}</div></section>
    <section class="panel"><div class="panel-head"><div><h2>Conciliações mais demoradas</h2><p>Tempo cronometrado em PLAY/PAUSE/STOP</p></div></div><div class="panel-body slow-list">
    ${slowest.length ? slowest.map((item) => `<div class="slow-row"><span title="${esc(item.company_name)}">${esc(item.account)}<small>${esc(item.company_name)}</small></span><strong>${duration(item.seconds)}</strong></div>`).join("") : '<div class="empty">Os tempos aparecerão após o primeiro PLAY.</div>'}</div></section></div>`;
}
function renderExecution() {
  const tasks = monthlyTasks().filter((item) => {
    const text = `${item.account} ${item.group_name || ""} ${item.company_name} ${item.owner_name}`.toLocaleLowerCase("pt-BR");
    return text.includes(state.query.toLocaleLowerCase("pt-BR")) && (!state.companyFilter || item.company_id === state.companyFilter)
      && (!state.ownerFilter || item.responsible_id === state.ownerFilter) && (!state.statusFilter || statusOf(item) === state.statusFilter);
  });
  const memberOptions = state.members.filter((item) => item.active).map((item) => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join("");
  return `<section class="panel"><div class="filters"><input id="search" class="input" placeholder="Buscar conta, empresa, grupo…" value="${esc(state.query)}">
    <select id="company-filter" class="select"><option value="">Todas as empresas</option>${state.companies.filter((item) => item.active).map((item) => `<option value="${esc(item.id)}" ${state.companyFilter === item.id ? "selected" : ""}>${esc(item.name)}</option>`).join("")}</select>
    <select id="owner-filter" class="select"><option value="">Todos os responsáveis</option>${state.members.filter((item) => item.active).map((item) => `<option value="${esc(item.id)}" ${state.ownerFilter === item.id ? "selected" : ""}>${esc(item.name)}</option>`).join("")}</select>
    <select id="status-filter" class="select"><option value="">Todos os status</option>${["Não iniciado", "Em andamento", "Pausado", "Finalizado"].map((item) => `<option ${state.statusFilter === item ? "selected" : ""}>${item}</option>`).join("")}</select></div>
    <div class="table-wrap"><table><thead><tr><th>Conta / grupo</th><th>Empresa</th><th>Responsável</th><th>Status</th><th>Tempo</th><th>Início · Brasília</th><th>Fim · Brasília</th><th>Controles</th></tr></thead>
    <tbody>${tasks.map((task) => { const activity = task.historic ? null : taskState(task.id); return `<tr><td><strong>${esc(task.account)}</strong><small>${esc(task.group_name || "")}</small></td><td>${esc(task.company_name)}</td>
      <td>${task.historic ? esc(task.owner_name) : `<select class="select" data-action="task-owner" data-id="${esc(task.id)}"><option value="">A definir</option>${memberOptions}</select>`}</td>
      <td>${badge(statusOf(task))}</td><td class="live-time" data-id="${esc(task.id)}">${task.historic ? "—" : duration(currentSeconds(activity))}</td>
      <td>${task.historic ? dateBR(task.start_date) : brasilia(activity?.first_started_at)}</td><td>${task.historic ? dateBR(task.end_date) : brasilia(activity?.finished_at)}</td>
      <td>${task.historic ? "—" : `<div class="actions"><button class="btn compact play" data-action="activity" data-id="${esc(task.id)}" data-kind="play" title="Iniciar">▶ PLAY</button><button class="btn compact pause" data-action="activity" data-id="${esc(task.id)}" data-kind="pause" title="Pausar">Ⅱ PAUSE</button><button class="btn compact stop" data-action="activity" data-id="${esc(task.id)}" data-kind="stop" title="Finalizar">■ STOP</button></div>`}</td></tr>`; }).join("")}</tbody></table>${tasks.length ? "" : '<div class="empty">Nenhuma atividade neste filtro.</div>'}</div>
    <div class="footer-note">${tasks.length} atividade(s). Os horários são apresentados no fuso de Brasília/DF.</div></section>`;
}
function renderGoals() {
  const companies = state.companies.filter((item) => isHistorical()
    ? state.targets.some((goal) => goal.company_id === item.id && goal.competence === state.month) : item.active)
    .map((company) => ({ ...company, goal: targetFor(company) }))
    .sort((a, b) => a.goal.category === b.goal.category ? a.goal.sort_order - b.goal.sort_order : a.goal.category === "HOLDING" ? -1 : 1);
  return `<section class="panel"><div class="panel-head"><div><h2>Ordem mensal de fechamento</h2><p>HOLDING primeiro. O dia útil programa a data no mês seguinte.</p></div></div>
    <div class="table-wrap"><table style="min-width:1500px"><thead><tr><th>Ordem</th><th>Empresa</th><th>Prioridade</th><th>Dia útil</th><th>Previsão</th><th>Data de entrega</th>${departments.map((item) => `<th>${item}</th>`).join("")}<th>Mover</th></tr></thead>
    <tbody>${companies.map((company, index) => { const goal = company.goal; return `<tr><td><strong>${index + 1}</strong></td><td><strong>${esc(company.name)}</strong><small>${esc(company.cnpj || "CNPJ não informado")}</small></td>
      <td><select class="select" data-action="goal-category" data-id="${esc(company.id)}" ${isHistorical() ? "disabled" : ""}><option ${goal.category === "HOLDING" ? "selected" : ""}>HOLDING</option><option ${goal.category === "DEMAIS" ? "selected" : ""}>DEMAIS</option></select></td>
      <td><input class="input" type="number" min="1" max="23" data-action="goal-day" data-id="${esc(company.id)}" value="${esc(goal.business_day || "")}" ${isHistorical() ? "disabled" : ""} style="width:75px"></td>
      <td><strong>${dateBR(isHistorical() ? goal.legacy_deadline : plannedDate(state.month, goal.business_day))}</strong></td><td>${goal.delivery_at ? brasilia(goal.delivery_at) : '<span class="muted">Aguardando última rotina</span>'}</td>
      ${departments.map((department) => { const receipt = receiptFor(company.id, department); return `<td><select class="select" data-action="receipt" data-id="${esc(company.id)}" data-department="${department}" ${isHistorical() ? "disabled" : ""}><option value="" ${!receipt || receipt.status === "Pendente" ? "selected" : ""}>Pendente</option><option ${receipt?.status === "Recebido" ? "selected" : ""}>Recebido</option><option ${receipt?.status === "N/A" ? "selected" : ""}>N/A</option></select><small>${receipt?.received_at ? brasilia(receipt.received_at) : receipt?.status === "N/A" ? "Não aplicável" : "Aguardando"}</small></td>`; }).join("")}
      <td><div class="actions"><button class="btn compact" data-action="move" data-id="${esc(company.id)}" data-direction="up" ${index === 0 || companies[index - 1].goal.category !== goal.category || isHistorical() ? "disabled" : ""}>↑</button><button class="btn compact" data-action="move" data-id="${esc(company.id)}" data-direction="down" ${index === companies.length - 1 || companies[index + 1].goal.category !== goal.category || isHistorical() ? "disabled" : ""}>↓</button></div></td></tr>`; }).join("")}</tbody></table></div>
    <div class="footer-note">Dias úteis: excluem sábados, domingos, feriados nacionais, 14/11 em Cascavel/PR, Corpus Christi 2026 e feriados adicionais cadastrados.</div></section>`;
}
function renderHistory() {
  const months = [...new Set([...state.history.map((item) => item.competence), ...state.states.map((item) => item.competence)])].sort();
  return `<div class="two-col"><section class="panel"><div class="panel-head"><h2>Resumo de ${esc(monthName(state.month))}</h2></div><div class="panel-body">
    <p><strong>${monthlyTasks().length}</strong> atividades; <strong>${monthlyTasks().filter((item) => ["Finalizado", "Concluída"].includes(statusOf(item))).length}</strong> finalizadas.</p>
    <p class="muted">Os fechamentos históricos preservam as datas já cadastradas. Os tempos em horas começam com os apontamentos feitos no painel.</p></div></section>
    <section class="panel"><div class="panel-head"><h2>Meses registrados</h2></div><div class="panel-body history-grid">${months.map((month) => { const count = state.history.filter((item) => item.competence === month).length || state.states.filter((item) => item.competence === month).length; return `<button class="history-month" data-action="choose-month" data-month="${month}">${esc(monthName(month))}<strong>${count}</strong><small>registros</small></button>`; }).join("") || '<div class="empty">Histórico ainda não migrado.</div>'}</div></section></div>`;
}
function renderRegistry() {
  const companyOptions = state.companies.filter((item) => item.active).map((item) => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join("");
  const memberOptions = state.members.filter((item) => item.active).map((item) => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join("");
  const legacyOwners = [...new Set(state.tasks.filter((item) => item.active && !item.responsible_id && item.responsible_legacy_name).map((item) => item.responsible_legacy_name))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  return `<div class="two-col"><section class="panel"><div class="panel-head"><h2>Responsáveis e acessos</h2></div><div class="panel-body">
    ${state.member?.is_admin ? `<form id="invite-form" class="form-grid"><label class="field"><span>Nome</span><input class="input" name="name" required></label><label class="field"><span>E-mail</span><input class="input" type="email" name="email" required></label><button class="btn primary" type="submit">Convidar responsável</button></form>` : '<p class="muted">Somente o administrador cadastra novos acessos.</p>'}
    <h3 class="section-title" style="margin-top:22px">Cadastrados com acesso</h3><div class="list">${state.members.map((person) => `<div class="list-row"><div><input class="input" data-member-name="${esc(person.id)}" value="${esc(person.name)}" ${state.member?.is_admin ? "" : "disabled"}><small>${esc(person.email)} ${person.is_admin ? "· administrador" : ""}</small></div>${state.member?.is_admin ? `<button class="btn compact" data-action="member-name" data-id="${esc(person.id)}">Salvar</button>` : ""}</div>`).join("")}</div>
    <h3 class="section-title" style="margin-top:22px">Pré-cadastrados sem acesso</h3><p class="muted">Ao convidar com o mesmo nome, as rotinas são vinculadas à conta.</p><div class="list">${legacyOwners.map((name) => `<div class="list-row"><input class="input" data-legacy-name="${esc(name)}" value="${esc(name)}" ${state.member?.is_admin ? "" : "disabled"}>${state.member?.is_admin ? `<button class="btn compact" data-action="legacy-name" data-old="${esc(name)}">Salvar</button>` : ""}</div>`).join("")}</div></div></section>
    <section class="panel"><div class="panel-head"><h2>Empresas / CNPJs</h2></div><div class="panel-body"><form id="company-form" class="form-grid"><label class="field wide"><span>Razão social</span><input class="input" name="name" required></label><label class="field"><span>CNPJ</span><input class="input" name="cnpj" placeholder="00.000.000/0000-00" required></label><label class="field"><span>Prioridade inicial</span><select class="select" name="category"><option>DEMAIS</option><option>HOLDING</option></select></label><button class="btn primary" type="submit">Incluir empresa</button></form>
    <h3 class="section-title" style="margin-top:22px">Cadastradas</h3><div class="list">${state.companies.filter((item) => item.active).map((item) => `<div class="list-row"><div><strong>${esc(item.name)}</strong><small>${esc(item.cnpj || "CNPJ não informado")} · ${esc(item.category)}</small></div></div>`).join("")}</div></div></section>
    <section class="panel"><div class="panel-head"><h2>Contas / rotinas</h2></div><div class="panel-body"><form id="task-form" class="form-grid"><label class="field wide"><span>Empresa</span><select class="select" name="company_id" required><option value="">Selecione</option>${companyOptions}</select></label><label class="field"><span>Conta / rotina</span><input class="input" name="account" required></label><label class="field"><span>Grupo</span><input class="input" name="group_name" value="OUTROS"></label><label class="field wide"><span>Responsável</span><select class="select" name="responsible_id"><option value="">A definir</option>${memberOptions}</select></label><button class="btn primary" type="submit">Incluir rotina</button></form>
    <h3 class="section-title" style="margin-top:22px">${state.tasks.filter((item) => item.active).length} rotinas cadastradas</h3><div class="list">${state.tasks.filter((item) => item.active).map((item) => `<div class="list-row"><div><strong>${esc(item.account)}</strong><small>${esc(companyName(item.company_id))} · ${esc(memberName(item.responsible_id, item.responsible_legacy_name))}</small></div></div>`).join("")}</div></div></section>
    <section class="panel"><div class="panel-head"><h2>Feriados adicionais</h2></div><div class="panel-body"><p class="muted">Use para feriados estaduais, municipais ou dias sem expediente confirmados pelo setor.</p><form id="holiday-form" class="form-grid"><label class="field"><span>Data</span><input class="input" type="date" name="date" required></label><label class="field"><span>Descrição</span><input class="input" name="name" required></label><button class="btn primary" type="submit">Adicionar feriado</button></form><div class="list" style="margin-top:20px">${state.holidays.sort((a, b) => a.date.localeCompare(b.date)).map((item) => `<div class="list-row"><span>${dateBR(item.date)} · ${esc(item.name)}</span></div>`).join("")}</div></div></section></div>`;
}
function render() {
  if (!state.session || state.needsPassword) return renderAuth();
  if (!state.ready) { $("#app").innerHTML = '<div class="loading">Carregando dados protegidos…</div>'; return; }
  if (!state.member) {
    $("#app").innerHTML = `<div class="auth-screen"><div class="auth-box"><h1>Acesso pendente</h1><p>${esc(state.error || "Peça ao administrador para liberar seu e-mail.")}</p><button class="btn" data-action="logout">Sair</button></div></div>`;
    return;
  }
  const content = state.tab === "Painel" ? renderPanel() : state.tab === "Execução" ? renderExecution() : state.tab === "Metas" ? renderGoals() : state.tab === "Histórico" ? renderHistory() : renderRegistry();
  $("#app").innerHTML = `<header class="topbar"><div class="topbar-inner"><div class="brand"><small>Grupo Cavalca</small><strong>Fechamento contábil</strong></div><div class="top-actions">
    <select class="select" id="month" aria-label="Mês de fechamento" style="width:auto">${monthOptions()}</select>
    <span class="status-pill ${state.online ? "" : "offline"}">${state.online ? state.queue.length ? `${state.queue.length} pendente(s)` : "Sincronizado" : `Offline · ${state.queue.length} pendente(s)`}</span>
    <span style="font-size:12px">${esc(state.member.name)}</span><button class="btn compact" data-action="logout">Sair</button></div></div></header>
    <main class="shell">${state.error ? `<div class="notice warn">${esc(state.error)}</div>` : ""}
    <nav class="tabs" aria-label="Seções">${tabNames.map((name) => `<button data-action="tab" data-tab="${name}" class="${state.tab === name ? "active" : ""}">${name}</button>`).join("")}</nav>${content}</main>`;
  document.querySelectorAll('[data-action="task-owner"]').forEach((element) => { element.value = state.tasks.find((item) => item.id === element.dataset.id)?.responsible_id || ""; });
}
function changeLocal(table, row, keys) {
  const array = state[table];
  const index = array.findIndex((item) => keys.every((key) => item[key] === row[key]));
  if (index < 0) array.push(row); else array[index] = { ...array[index], ...row };
}
function saveGoal(companyId, values) {
  const company = state.companies.find((item) => item.id === companyId);
  if (!company) return;
  const existing = state.targets.find((item) => item.company_id === companyId && item.competence === state.month);
  const row = { ...targetFor(company), ...values, updated_at: new Date().toISOString() };
  changeLocal("targets", row, ["company_id", "competence"]);
  if (existing) enqueue({ kind: "update", table: "fc_targets", where: { company_id: companyId, competence: state.month }, values: { ...values, updated_at: row.updated_at } });
  else enqueue({ kind: "upsert", table: "fc_targets", row, conflict: "company_id,competence" });
}
function act(taskId, action) {
  if (isHistorical()) return;
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return;
  const now = new Date().toISOString();
  const previous = taskState(taskId) || { task_id: taskId, competence: state.month, status: "Não iniciado", total_seconds: 0 };
  if (action === "play" && previous.status === "Em andamento") return;
  if (action === "pause" && previous.status !== "Em andamento") return toast("Inicie a rotina antes de pausá-la.");
  if (action === "stop" && previous.status === "Finalizado") return;
  const elapsed = action !== "play" && previous.status === "Em andamento" && previous.started_at ? Math.max(0, Math.floor((Date.parse(now) - Date.parse(previous.started_at)) / 1000)) : 0;
  const row = { ...previous, status: action === "play" ? "Em andamento" : action === "pause" ? "Pausado" : "Finalizado", total_seconds: previous.total_seconds + elapsed,
    started_at: action === "play" ? now : null, first_started_at: previous.first_started_at || (action === "play" ? now : null),
    finished_at: action === "stop" ? now : null, updated_at: now, last_actor_id: state.member.id };
  changeLocal("states", row, ["task_id", "competence"]);
  const companyTasks = state.tasks.filter((item) => item.company_id === task.company_id && item.active);
  let goal = state.targets.find((item) => item.company_id === task.company_id && item.competence === state.month);
  if (!goal) {
    goal = targetFor(state.companies.find((item) => item.id === task.company_id));
    state.targets.push(goal);
  }
  goal.delivery_at = companyTasks.every((item) => state.states.find((entry) => entry.task_id === item.id && entry.competence === state.month)?.status === "Finalizado")
    ? companyTasks.map((item) => state.states.find((entry) => entry.task_id === item.id && entry.competence === state.month)?.finished_at).filter(Boolean).sort().at(-1) : null;
  enqueue({ kind: "rpc", name: "fc_apply_activity", args: { p_event_id: uid(), p_task_id: taskId, p_competence: state.month, p_action: action, p_occurred_at: now } });
}
async function inviteMember(form) {
  if (!state.online) return toast("Convites exigem conexão com a internet.");
  const email = field(form, "email").value.trim().toLowerCase();
  const name = field(form, "name").value.trim();
  if (!email || name.length < 2) return toast("Informe nome e e-mail válidos.");
  const { data, error } = await client.functions.invoke("fc-invite-member", { body: { email, name } });
  if (error || !data?.ok) return toast(`Convite não enviado: ${error?.message || data?.error || "função indisponível"}`);
  form.reset(); toast(data.existingUser
    ? "Acesso liberado. A pessoa pode entrar com a senha que já usa neste Supabase."
    : "Convite enviado. O responsável definirá a senha no primeiro acesso."); await loadData();
}
document.addEventListener("submit", async (event) => {
  const form = event.target;
  if (!["auth-form", "invite-form", "company-form", "task-form", "holiday-form"].includes(form.id)) return;
  event.preventDefault();
  try {
    if (form.id === "auth-form") {
      const password = field(form, "password").value;
      if (state.needsPassword) {
        if (password !== field(form, "confirm").value) throw new Error("As senhas não coincidem.");
        const { error } = await client.auth.updateUser({ password });
        if (error) throw error;
        state.needsPassword = false; history.replaceState(null, "", location.pathname); await loadData();
      } else {
        const { data, error } = await client.auth.signInWithPassword({ email: field(form, "email").value.trim(), password });
        if (error) throw error;
        state.session = data.session; loadCache(); await loadData();
      }
    } else if (form.id === "invite-form") await inviteMember(form);
    else if (form.id === "company-form") {
      const name = field(form, "name").value.trim(), cnpj = field(form, "cnpj").value.replace(/\D/g, ""), category = field(form, "category").value;
      if (!name || !validCnpj(cnpj)) throw new Error("Informe uma empresa e um CNPJ válido.");
      if (state.companies.some((item) => item.cnpj === cnpj)) throw new Error("Este CNPJ já está cadastrado.");
      const id = uid();
      const company = { id, name, source_name: name, cnpj, category, active: true };
      state.companies.push(company); enqueue({ kind: "upsert", table: "fc_companies", row: company, conflict: "id" });
      const goal = { company_id: id, competence: state.month, category, sort_order: state.targets.length + 1, business_day: null, planned_date: null, delivery_at: null };
      state.targets.push(goal); enqueue({ kind: "upsert", table: "fc_targets", row: goal, conflict: "company_id,competence" });
      const review = { id: `review-${id}`, company_id: id, account: "REVISÃO DE BALANCETE", group_name: "ENCERRAMENTO", responsible_id: null, responsible_legacy_name: null, active: true };
      state.tasks.push(review); enqueue({ kind: "upsert", table: "fc_tasks", row: review, conflict: "id" });
      form.reset(); toast("Empresa e revisão cadastradas."); render();
    } else if (form.id === "task-form") {
      const company_id = field(form, "company_id").value, account = field(form, "account").value.trim();
      if (!company_id || !account) throw new Error("Informe empresa e rotina.");
      const row = { id: uid(), company_id, account, group_name: field(form, "group_name").value.trim() || "OUTROS", responsible_id: field(form, "responsible_id").value || null, responsible_legacy_name: null, active: true };
      state.tasks.push(row); enqueue({ kind: "upsert", table: "fc_tasks", row, conflict: "id" });
      const goal = state.targets.find((item) => item.company_id === company_id && item.competence === state.month);
      if (goal?.delivery_at) saveGoal(company_id, { delivery_at: null });
      form.reset(); toast("Rotina cadastrada."); render();
    } else if (form.id === "holiday-form") {
      const row = { date: field(form, "date").value, name: field(form, "name").value.trim(), created_by: state.member.id };
      if (!row.date || !row.name) throw new Error("Informe data e descrição.");
      changeLocal("holidays", row, ["date"]); enqueue({ kind: "upsert", table: "fc_holidays", row, conflict: "date" }); form.reset();
    }
  } catch (error) { toast(error.message || String(error)); const message = $("#auth-error"); if (message) message.textContent = error.message || String(error); }
});
document.addEventListener("input", (event) => {
  if (event.target.id === "search") { state.query = event.target.value; const pos = event.target.selectionStart; render(); const input = $("#search"); input.focus(); input.setSelectionRange(pos, pos); }
});
document.addEventListener("change", (event) => {
  const element = event.target;
  if (element.id === "month") { state.month = element.value; state.query = ""; render(); return; }
  if (element.id === "company-filter") { state.companyFilter = element.value; render(); return; }
  if (element.id === "owner-filter") { state.ownerFilter = element.value; render(); return; }
  if (element.id === "status-filter") { state.statusFilter = element.value; render(); return; }
  const { action, id, department } = element.dataset;
  if (action === "task-owner") {
    const task = state.tasks.find((item) => item.id === id); if (!task) return;
    task.responsible_id = element.value || null; task.responsible_legacy_name = null;
    enqueue({ kind: "update", table: "fc_tasks", where: { id }, values: { responsible_id: task.responsible_id, responsible_legacy_name: null } });
  } else if (action === "goal-category") saveGoal(id, { category: element.value });
  else if (action === "goal-day") {
    const day = element.value ? Number(element.value) : null;
    if (day && (day < 1 || day > 23)) return toast("Informe um dia útil entre 1 e 23.");
    saveGoal(id, { business_day: day, planned_date: plannedDate(state.month, day) });
  } else if (action === "receipt") {
    const received_at = element.value === "Recebido" ? new Date().toISOString() : null;
    const row = { company_id: id, competence: state.month, department, status: element.value || "Pendente", received_at, updated_by: state.member.id };
    changeLocal("receipts", row, ["company_id", "competence", "department"]);
    enqueue({ kind: "upsert", table: "fc_receipts", row, conflict: "company_id,competence,department" });
  }
});
document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]"); if (!button) return;
  const { action, id } = button.dataset;
  if (action === "tab") { state.tab = button.dataset.tab; render(); }
  else if (action === "activity") act(id, button.dataset.kind);
  else if (action === "choose-month") { state.month = button.dataset.month; state.tab = "Execução"; render(); }
  else if (action === "member-name") {
    const member = state.members.find((item) => item.id === id);
    const name = document.querySelector(`[data-member-name="${CSS.escape(id)}"]`)?.value.trim();
    if (!member || !name || name.length < 2) return toast("Informe um nome válido.");
    member.name = name; enqueue({ kind: "update", table: "fc_members", where: { id }, values: { name } });
  } else if (action === "legacy-name") {
    const oldName = button.dataset.old;
    const name = document.querySelector(`[data-legacy-name="${CSS.escape(oldName)}"]`)?.value.trim();
    if (!name || name.length < 2) return toast("Informe um nome válido.");
    const tasks = state.tasks.filter((item) => !item.responsible_id && item.responsible_legacy_name === oldName);
    for (const task of tasks) {
      task.responsible_legacy_name = name;
      enqueue({ kind: "update", table: "fc_tasks", where: { id: task.id }, values: { responsible_legacy_name: name } });
    }
    toast(`${tasks.length} rotina(s) atualizada(s).`);
  } else if (action === "move") {
    const company = state.companies.find((item) => item.id === id); if (!company) return;
    const ordered = state.companies.filter((item) => item.active).map((item) => ({ ...item, goal: targetFor(item) })).sort((a, b) => a.goal.category === b.goal.category ? a.goal.sort_order - b.goal.sort_order : a.goal.category === "HOLDING" ? -1 : 1);
    const index = ordered.findIndex((item) => item.id === id), other = ordered[index + (button.dataset.direction === "up" ? -1 : 1)];
    if (!other || other.goal.category !== ordered[index].goal.category) return;
    const previousOrder = ordered[index].goal.sort_order, nextOrder = other.goal.sort_order;
    saveGoal(id, { sort_order: nextOrder }); saveGoal(other.id, { sort_order: previousOrder });
  } else if (action === "forgot-password") {
    const email = prompt("Informe o e-mail cadastrado para receber o link de recuperação:");
    if (!email) return;
    const { error } = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo: location.href.split("#")[0] });
    toast(error ? error.message : "Se o e-mail estiver cadastrado, você receberá instruções para redefinir a senha.");
  } else if (action === "logout") {
    if (state.queue.length) return toast("Há registros pendentes. Sincronize antes de sair para não perdê-los.");
    localStorage.removeItem(cacheKey()); localStorage.removeItem(queueKey());
    await client.auth.signOut(); state.session = null; state.member = null; state.ready = false; render();
  }
});
window.addEventListener("online", () => { state.online = true; void flush(); render(); });
window.addEventListener("offline", () => { state.online = false; render(); });
setInterval(() => {
  state.tick = Date.now();
  if (state.tab !== "Execução") return;
  document.querySelectorAll(".live-time").forEach((element) => { element.textContent = duration(currentSeconds(taskState(element.dataset.id))); });
}, 1000);
setInterval(() => { if (state.session && state.member && state.online) state.queue.length ? void flush() : void loadData(); }, 20000);
client.auth.onAuthStateChange((_event, session) => {
  if (_event === "PASSWORD_RECOVERY") state.needsPassword = true;
  if (session && !state.session) { state.session = session; loadCache(); setTimeout(() => void loadData(), 0); }
});
(async () => {
  const { data } = await client.auth.getSession();
  state.session = data.session;
  if (state.session) { loadCache(); await loadData(); }
  else renderAuth();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})();

