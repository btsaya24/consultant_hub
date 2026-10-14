/* Consultant Hub – front (vanilla JS, aucune dépendance) */
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = n => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n || 0);
const fmtDate = d => d ? new Date(d + 'T00:00:00Z').toLocaleDateString('fr-FR', { timeZone: 'UTC' }) : '—';
const num = n => Number(n || 0).toLocaleString('fr-FR', { maximumFractionDigits: 1 });

let demo = null; // défini au démarrage si aucun serveur n'est joignable (ex. GitHub Pages)

async function api(path, { method = 'GET', body } = {}) {
  if (demo) return demo.handle(method, path, body);
  const r = await fetch('api' + path, {
    method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || r.statusText);
  return data;
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}
const fail = e => toast('⚠ ' + e.message);

/* ---------- État & mois ---------- */
const now = new Date();
const state = { month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}` };
const monthLabel = m => new Date(m + '-01T00:00:00Z').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
function shiftMonth(m, delta) {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
$('#prevMonth').onclick = () => { state.month = shiftMonth(state.month, -1); route(); };
$('#nextMonth').onclick = () => { state.month = shiftMonth(state.month, 1); route(); };

/* ---------- Composants ---------- */
const hue = s => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
const avatar = c => `<div class="avatar" style="background:hsl(${hue(c.first_name + c.last_name)} 55% 45%)">${esc(c.first_name[0])}${esc(c.last_name[0])}</div>`;
const availBadge = a => `<span class="badge ${a === 'En mission' ? 'info' : a === 'Disponible' ? 'ok' : 'warn'}">${esc(a === 'Disponible' ? 'Disponible' : a)}</span>`;
const statusBadge = s => `<span class="badge ${{ Validé: 'ok', Soumis: 'info', Brouillon: 'neutral', Refusé: 'bad', 'Non saisi': 'warn', 'En cours': 'info', 'À venir': 'warn', Terminée: 'neutral' }[s] || 'neutral'}">${esc(s)}</span>`;

function openModal(html, onMount) {
  const root = $('#modalRoot');
  root.innerHTML = `<div class="overlay"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
  const close = () => { root.innerHTML = ''; document.removeEventListener('keydown', esc_); };
  const esc_ = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', esc_);
  $('.overlay', root).addEventListener('mousedown', e => { if (e.target.classList.contains('overlay')) close(); });
  root.querySelectorAll('[data-close]').forEach(b => b.onclick = close);
  onMount && onMount(root, close);
  return close;
}

/* ---------- Routeur ---------- */
const view = $('#view');
function route() {
  const [, name = 'dashboard', arg] = (location.hash || '#/dashboard').split('/');
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.dataset.route === name));
  const showMonth = ['dashboard', 'cra'].includes(name);
  $('#monthPicker').hidden = !showMonth;
  $('#monthLabel').textContent = monthLabel(state.month);
  window.scrollTo(0, 0);
  const views = { dashboard: viewDashboard, consultants: arg ? viewConsultant : viewConsultants, missions: viewMissions, cra: arg ? viewCraEditor : viewCra };
  (views[name] || viewDashboard)(arg).catch(e => { view.innerHTML = `<div class="note">${esc(e.message)}</div>`; });
}
window.addEventListener('hashchange', route);

/* ---------- Tableau de bord ---------- */
async function viewDashboard() {
  const [d, list] = await Promise.all([api('/dashboard?month=' + state.month), api('/cra?month=' + state.month)]);
  const kpi = (label, value, hint = '') => `<div class="card kpi"><div class="label">${label}</div><div class="value">${value}</div><div class="hint">${hint}</div></div>`;
  view.innerHTML = `
    <h1>Tableau de bord</h1>
    <p class="sub" style="text-transform:capitalize">${monthLabel(state.month)}</p>
    <div class="grid-kpi">
      ${kpi('Consultants', d.consultants, `${d.available} disponibles · ${d.onMission} en mission`)}
      ${kpi('Missions en cours', d.activeMissions)}
      ${kpi('Jours travaillés', num(d.daysWorked), 'tous CRA confondus')}
      ${kpi('À facturer (CRA validés)', eur(d.toInvoice))}
      ${kpi('CRA à valider', d.pendingValidation, 'statut « Soumis »')}
      ${kpi('CRA manquants', d.craMissing, 'missions en cours non soumises')}
    </div>
    <div class="card">
      <h2>CRA du mois</h2>
      ${craTable(list)}
    </div>`;
  bindCraRows();
}

/* ---------- CVthèque ---------- */
const filters = { q: '', skills: new Set(), contract: '', availability: '', location: '', tjmMax: '', expMin: '' };

async function viewConsultants() {
  const allSkills = await api('/skills');
  view.innerHTML = `
    <div class="page-head">
      <div><h1>CVthèque</h1><p class="sub">Recherchez vos consultants par compétence, disponibilité et TJM.</p></div>
      <button class="btn primary" id="newConsultant">+ Nouveau consultant</button>
    </div>
    <div class="searchbar"><input type="search" id="q" placeholder="Nom, poste, technologie… (ex : Java, DevOps, Camille)" value="${esc(filters.q)}"></div>
    <div class="filters">
      <select id="fContract"><option value="">Tous contrats</option><option>Freelance</option><option>CDI</option></select>
      <select id="fAvail"><option value="">Toutes disponibilités</option><option>Disponible</option><option>En mission</option></select>
      <label>Ville <input id="fLoc" size="10" value="${esc(filters.location)}"></label>
      <label>TJM max <input type="number" id="fTjm" min="0" step="50" value="${esc(filters.tjmMax)}"></label>
      <label>Exp. min <input type="number" id="fExp" min="0" value="${esc(filters.expMin)}"> ans</label>
      <button class="btn" id="reset">Réinitialiser</button>
    </div>
    <div class="chips" id="skillChips">${allSkills.map(s => `<button class="chip ${filters.skills.has(s) ? 'on' : ''}" data-skill="${esc(s)}">${esc(s)}</button>`).join('')}</div>
    <div class="count" id="count"></div>
    <div class="results" id="results"></div>`;
  $('#fContract').value = filters.contract;
  $('#fAvail').value = filters.availability;

  let timer;
  const refresh = () => { clearTimeout(timer); timer = setTimeout(loadResults, 180); };
  $('#q').oninput = e => { filters.q = e.target.value; refresh(); };
  $('#fContract').onchange = e => { filters.contract = e.target.value; loadResults(); };
  $('#fAvail').onchange = e => { filters.availability = e.target.value; loadResults(); };
  $('#fLoc').oninput = e => { filters.location = e.target.value; refresh(); };
  $('#fTjm').oninput = e => { filters.tjmMax = e.target.value; refresh(); };
  $('#fExp').oninput = e => { filters.expMin = e.target.value; refresh(); };
  $('#skillChips').onclick = e => {
    const b = e.target.closest('[data-skill]');
    if (!b) return;
    const s = b.dataset.skill;
    filters.skills.has(s) ? filters.skills.delete(s) : filters.skills.add(s);
    b.classList.toggle('on');
    loadResults();
  };
  $('#reset').onclick = () => { Object.assign(filters, { q: '', skills: new Set(), contract: '', availability: '', location: '', tjmMax: '', expMin: '' }); viewConsultants(); };
  $('#newConsultant').onclick = () => consultantForm();
  await loadResults();
}

async function loadResults() {
  const p = new URLSearchParams();
  if (filters.q) p.set('q', filters.q);
  if (filters.skills.size) p.set('skill', [...filters.skills].join(','));
  for (const k of ['contract', 'availability', 'location', 'tjmMax', 'expMin']) if (filters[k]) p.set(k, filters[k]);
  const rows = await api('/consultants?' + p);
  $('#count').textContent = `${rows.length} consultant${rows.length > 1 ? 's' : ''}`;
  $('#results').innerHTML = rows.length ? rows.map(c => `
    <a class="card person" href="#/consultants/${c.id}">
      <div class="person-head">${avatar(c)}<div><h3>${esc(c.first_name)} ${esc(c.last_name)}</h3><div class="title">${esc(c.title)}</div></div></div>
      <div class="tags">${c.skills.slice(0, 5).map(s => `<span class="tag">${esc(s)}</span>`).join('')}</div>
      <div class="meta"><span>${esc(c.location || '—')} · ${c.experience} ans · ${esc(c.contract)}</span><strong>${c.tjm ? c.tjm + ' €/j' : '—'}</strong></div>
      <div>${availBadge(c.availability)}</div>
    </a>`).join('') : '<div class="empty" style="grid-column:1/-1">Aucun consultant ne correspond à ces critères.</div>';
}

async function viewConsultant(id) {
  const c = await api('/consultants/' + id);
  view.innerHTML = `
    <a class="back" href="#/consultants">← Retour à la CVthèque</a>
    <div class="page-head">
      <div class="person-head">${avatar(c)}<div><h1>${esc(c.first_name)} ${esc(c.last_name)}</h1><div class="sub" style="margin:0">${esc(c.title)}</div></div></div>
      <div style="display:flex;gap:8px"><button class="btn" id="edit">Modifier</button><button class="btn danger" id="del">Supprimer</button></div>
    </div>
    <div class="detail-grid" style="margin-top:18px">
      <div style="display:grid;gap:20px">
        <div class="card"><h2>Profil</h2><p>${esc(c.summary || '—')}</p><div class="tags">${c.skills.map(s => `<span class="tag">${esc(s)}</span>`).join('')}</div></div>
        <div class="card"><h2>Missions</h2>
          ${c.missions.length ? `<div class="table-wrap"><table><thead><tr><th>Mission</th><th>Client</th><th>Période</th><th class="num">TJM</th><th>Statut</th></tr></thead><tbody>
            ${c.missions.map(m => `<tr><td>${esc(m.title)}</td><td>${esc(m.client)}</td><td>${fmtDate(m.start_date)} → ${fmtDate(m.end_date)}</td><td class="num">${m.tjm_sold} €</td><td>${statusBadge(m.status)}</td></tr>`).join('')}
          </tbody></table></div>` : '<div class="empty">Aucune mission.</div>'}
        </div>
      </div>
      <div class="card"><h2>Informations</h2><dl>
        <dt>Disponibilité</dt><dd>${availBadge(c.availability)}</dd>
        <dt>Contrat</dt><dd>${esc(c.contract)}</dd>
        <dt>TJM</dt><dd>${c.tjm ? c.tjm + ' €' : '—'}</dd>
        <dt>Expérience</dt><dd>${c.experience} ans</dd>
        <dt>Localisation</dt><dd>${esc(c.location || '—')}</dd>
        <dt>Email</dt><dd>${esc(c.email || '—')}</dd>
        <dt>Téléphone</dt><dd>${esc(c.phone || '—')}</dd>
        <dt>ID dans le CRA</dt><dd>${esc(c.external_cra_id || '—')}</dd>
      </dl></div>
    </div>`;
  $('#edit').onclick = () => consultantForm(c);
  $('#del').onclick = async () => {
    if (!confirm(`Supprimer ${c.first_name} ${c.last_name} et ses missions ?`)) return;
    try { await api('/consultants/' + c.id, { method: 'DELETE' }); toast('Consultant supprimé'); location.hash = '#/consultants'; } catch (e) { fail(e); }
  };
}

function consultantForm(c = {}) {
  const v = (k, d = '') => esc(c[k] ?? d);
  openModal(`
    <h2>${c.id ? 'Modifier' : 'Nouveau'} consultant</h2>
    <form class="form" id="cForm">
      <label>Prénom<input name="first_name" required value="${v('first_name')}"></label>
      <label>Nom<input name="last_name" required value="${v('last_name')}"></label>
      <label class="full">Intitulé du poste<input name="title" required value="${v('title')}"></label>
      <label>Contrat<select name="contract"><option>Freelance</option><option>CDI</option></select></label>
      <label>TJM (€)<input type="number" name="tjm" min="0" step="10" value="${v('tjm')}"></label>
      <label>Ville<input name="location" value="${v('location')}"></label>
      <label>Années d'expérience<input type="number" name="experience" min="0" value="${v('experience', 0)}"></label>
      <label>Disponibilité<select name="availability"><option>Disponible</option><option>En mission</option></select></label>
      <label>ID dans le CRA<input name="external_cra_id" value="${v('external_cra_id')}"></label>
      <label class="full">Compétences (séparées par des virgules)<input name="skills" value="${esc((c.skills || []).join(', '))}"></label>
      <label>Email<input type="email" name="email" value="${v('email')}"></label>
      <label>Téléphone<input name="phone" value="${v('phone')}"></label>
      <label class="full">Résumé<textarea name="summary" rows="3">${v('summary')}</textarea></label>
      <div class="modal-actions full"><button type="button" class="btn" data-close>Annuler</button><button class="btn primary">Enregistrer</button></div>
    </form>`, (root, close) => {
    const f = $('#cForm', root);
    f.contract.value = c.contract || 'Freelance';
    f.availability.value = (c.availability || 'Disponible').startsWith('Disponible') ? 'Disponible' : 'En mission';
    f.onsubmit = async e => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(f));
      fd.skills = fd.skills.split(',').map(s => s.trim()).filter(Boolean);
      fd.tjm = fd.tjm ? Number(fd.tjm) : null;
      fd.experience = Number(fd.experience || 0);
      try {
        if (c.id) await api('/consultants/' + c.id, { method: 'PUT', body: fd });
        else await api('/consultants', { method: 'POST', body: fd });
        close(); toast('Consultant enregistré'); route();
      } catch (err) { fail(err); }
    };
  });
}

/* ---------- Missions ---------- */
async function viewMissions() {
  const rows = await api('/missions');
  view.innerHTML = `
    <div class="page-head">
      <div><h1>Missions</h1><p class="sub">Qui travaille chez quel client, à quel tarif.</p></div>
      <button class="btn primary" id="newMission">+ Nouvelle mission</button>
    </div>
    <div class="card"><div class="table-wrap">
      ${rows.length ? `<table><thead><tr><th>Consultant</th><th>Mission</th><th>Client</th><th>Période</th><th class="num">TJM vendu</th><th class="num">Marge/j</th><th>Statut</th><th></th></tr></thead><tbody>
      ${rows.map(m => `<tr>
        <td><strong>${esc(m.consultant)}</strong><div class="sub" style="margin:0;font-size:12.5px">${esc(m.consultant_title)}</div></td>
        <td>${esc(m.title)}</td><td>${esc(m.client)}</td>
        <td>${fmtDate(m.start_date)} → ${fmtDate(m.end_date)}</td>
        <td class="num">${m.tjm_sold} €</td>
        <td class="num">${m.consultant_tjm != null ? m.tjm_sold - m.consultant_tjm + ' €' : '—'}</td>
        <td>${statusBadge(m.status)}</td>
        <td class="num">${m.status === 'En cours' ? `<button class="btn" data-end="${m.id}">Terminer</button>` : m.status === 'À venir' ? `<button class="btn" data-start="${m.id}">Démarrer</button>` : ''}</td>
      </tr>`).join('')}</tbody></table>` : '<div class="empty">Aucune mission pour le moment.</div>'}
    </div></div>`;
  $('#newMission').onclick = missionForm;
  const setStatus = (attr, status) => view.querySelectorAll(`[${attr}]`).forEach(b => b.onclick = async () => {
    try {
      const id = b.getAttribute(attr);
      const body = { status };
      if (status === 'Terminée') body.end_date = new Date().toISOString().slice(0, 10);
      await api('/missions/' + id, { method: 'PATCH', body });
      toast('Mission mise à jour'); route();
    } catch (e) { fail(e); }
  });
  setStatus('data-end', 'Terminée');
  setStatus('data-start', 'En cours');
}

async function missionForm() {
  const [consultants, clients] = await Promise.all([api('/consultants'), api('/clients')]);
  openModal(`
    <h2>Nouvelle mission</h2>
    <form class="form" id="mForm">
      <label class="full">Consultant<select name="consultant_id" required>${consultants.map(c => `<option value="${c.id}">${esc(c.first_name)} ${esc(c.last_name)} — ${esc(c.availability)}</option>`).join('')}</select></label>
      <label class="full">Client<select name="client_id" id="clientSel">${clients.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}<option value="__new">+ Nouveau client…</option></select></label>
      <label class="full" id="newClientRow" hidden>Nom du nouveau client<input name="new_client"></label>
      <label class="full">Intitulé de la mission<input name="title" required></label>
      <label>Début<input type="date" name="start_date" required></label>
      <label>Fin (optionnel)<input type="date" name="end_date"></label>
      <label>TJM vendu (€)<input type="number" name="tjm_sold" min="1" step="10" required></label>
      <label>Statut<select name="status"><option>En cours</option><option>À venir</option></select></label>
      <div class="modal-actions full"><button type="button" class="btn" data-close>Annuler</button><button class="btn primary">Créer</button></div>
    </form>`, (root, close) => {
    const f = $('#mForm', root);
    f.client_id.onchange = () => { $('#newClientRow', root).hidden = f.client_id.value !== '__new'; };
    f.onsubmit = async e => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(f));
      try {
        if (fd.client_id === '__new') {
          if (!fd.new_client.trim()) throw new Error('Indiquez le nom du client.');
          fd.client_id = (await api('/clients', { method: 'POST', body: { name: fd.new_client.trim() } })).id;
        }
        delete fd.new_client;
        fd.tjm_sold = Number(fd.tjm_sold);
        await api('/missions', { method: 'POST', body: fd });
        close(); toast('Mission créée'); route();
      } catch (err) { fail(err); }
    };
  });
}

/* ---------- CRA : liste ---------- */
function craTable(list) {
  if (!list.length) return '<div class="empty">Aucune mission active sur ce mois.</div>';
  return `<div class="table-wrap"><table><thead><tr><th>Consultant</th><th>Client · Mission</th><th class="num">Jours</th><th class="num">Montant</th><th>Statut</th></tr></thead><tbody>
    ${list.map(r => `<tr class="clickable" data-cra="${r.id}">
      <td><strong>${esc(r.consultant)}</strong></td><td>${esc(r.client)} · ${esc(r.title)}</td>
      <td class="num">${num(r.daysWorked)}</td><td class="num">${eur(r.amount)}</td><td>${statusBadge(r.status)}</td></tr>`).join('')}
  </tbody></table></div>`;
}
const bindCraRows = () => view.querySelectorAll('[data-cra]').forEach(tr => tr.onclick = () => { location.hash = '#/cra/' + tr.dataset.cra; });

async function viewCra() {
  const list = await api('/cra?month=' + state.month);
  const pending = list.filter(r => r.status === 'Soumis').length;
  view.innerHTML = `
    <h1>Comptes rendus d'activité</h1>
    <p class="sub" style="text-transform:capitalize">${monthLabel(state.month)} · ${pending} à valider</p>
    <div class="card">${craTable(list)}</div>`;
  bindCraRows();
}

/* ---------- CRA : saisie / validation ---------- */
const CYCLE = ['', 'w1', 'w05', 'leave'];
async function viewCraEditor(missionId) {
  const [missions, cra] = await Promise.all([api('/missions'), api(`/missions/${missionId}/cra/${state.month}`)]);
  const m = missions.find(x => String(x.id) === String(missionId));
  if (!m) throw new Error('Mission introuvable');

  // état des jours : { 'YYYY-MM-DD': 'w1' | 'w05' | 'leave' }
  const days = {};
  for (const d of cra.days) days[d.day] = d.kind === 'Congé' ? 'leave' : d.value === 0.5 ? 'w05' : d.value === 1 ? 'w1' : '';
  const editable = ['Brouillon', 'Refusé'].includes(cra.status);

  const [y, mo] = state.month.split('-').map(Number);
  const nbDays = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const firstDow = (new Date(Date.UTC(y, mo - 1, 1)).getUTCDay() + 6) % 7; // lundi = 0

  const totals = () => {
    let worked = 0, leave = 0;
    Object.values(days).forEach(v => { if (v === 'w1') worked += 1; else if (v === 'w05') worked += .5; else if (v === 'leave') leave += 1; });
    return { worked, leave, amount: worked * m.tjm_sold };
  };

  const render = () => {
    const t = totals();
    const cells = [];
    for (let i = 0; i < firstDow; i++) cells.push('<div></div>');
    for (let d = 1; d <= nbDays; d++) {
      const key = `${state.month}-${String(d).padStart(2, '0')}`;
      const dow = (new Date(Date.UTC(y, mo - 1, d)).getUTCDay() + 6) % 7;
      const wk = dow >= 5;
      const st = days[key] || '';
      const label = { w1: '1 j', w05: '½ j', leave: 'Congé' }[st] || '';
      cells.push(`<button class="day ${wk ? 'off' : st}" data-day="${key}" ${wk || !editable ? 'disabled' : ''}><span class="n">${d}</span><span class="v">${label}</span></button>`);
    }
    view.innerHTML = `
      <a class="back" href="#/cra">← Retour aux CRA</a>
      <div class="page-head">
        <div><h1>${esc(m.consultant)}</h1><p class="sub" style="margin:0">${esc(m.client)} · ${esc(m.title)} · <span style="text-transform:capitalize">${monthLabel(state.month)}</span></p></div>
        <div>${statusBadge(cra.status)}</div>
      </div>
      ${cra.status === 'Refusé' && cra.comment ? `<div class="note"><strong>CRA refusé :</strong> ${esc(cra.comment)}</div>` : ''}
      <div class="grid-kpi" style="margin-top:18px">
        <div class="card kpi"><div class="label">Jours travaillés</div><div class="value">${num(t.worked)}</div></div>
        <div class="card kpi"><div class="label">Congés</div><div class="value">${num(t.leave)}</div></div>
        <div class="card kpi"><div class="label">Montant (${m.tjm_sold} €/j)</div><div class="value">${eur(t.amount)}</div></div>
      </div>
      <div class="card">
        <div class="cra-bar">
          <strong>${editable ? 'Cliquez sur un jour pour changer : 1 j → ½ j → congé → vide' : 'CRA verrouillé'}</strong>
          <div class="cra-actions">
            ${editable ? `<button class="btn" id="fill">Remplir les jours ouvrés</button><button class="btn" id="clear">Vider</button><button class="btn" id="save">Enregistrer</button><button class="btn primary" id="submit">Soumettre</button>` : ''}
            ${cra.status === 'Soumis' ? `<button class="btn danger" id="reject">Refuser</button><button class="btn ok" id="validate">Valider</button>` : ''}
          </div>
        </div>
        <div class="cal">${['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map(d => `<div class="dow">${d}</div>`).join('')}${cells.join('')}</div>
        <div class="legend"><span><i style="background:var(--ok-soft);border:1px solid var(--ok)"></i>Journée</span><span><i style="background:var(--info-soft);border:1px solid var(--info)"></i>Demi-journée</span><span><i style="background:var(--warn-soft);border:1px solid var(--warn)"></i>Congé</span></div>
      </div>`;
    bind();
  };

  const payload = () => Object.entries(days).filter(([, v]) => v).map(([day, v]) => ({ day, value: v === 'w05' ? 0.5 : 1, kind: v === 'leave' ? 'Congé' : 'Travaillé' }));
  const save = async () => { Object.assign(cra, await api(`/missions/${missionId}/cra/${state.month}`, { method: 'PUT', body: { days: payload() } })); };
  const act = async (action, body = {}) => { Object.assign(cra, await api(`/missions/${missionId}/cra/${state.month}/${action}`, { method: 'POST', body })); };

  function bind() {
    view.querySelectorAll('.day:not(.off)').forEach(b => b.onclick = () => {
      if (!editable) return;
      const cur = days[b.dataset.day] || '';
      const next = CYCLE[(CYCLE.indexOf(cur) + 1) % CYCLE.length];
      next ? days[b.dataset.day] = next : delete days[b.dataset.day];
      render();
    });
    const on = (id, fn) => { const el = $('#' + id); if (el) el.onclick = () => fn().catch(fail); };
    on('fill', async () => {
      for (let d = 1; d <= nbDays; d++) {
        const dow = (new Date(Date.UTC(y, mo - 1, d)).getUTCDay() + 6) % 7;
        if (dow < 5) { const k = `${state.month}-${String(d).padStart(2, '0')}`; if (!days[k]) days[k] = 'w1'; }
      }
      render();
    });
    on('clear', async () => { Object.keys(days).forEach(k => delete days[k]); render(); });
    on('save', async () => { await save(); toast('CRA enregistré'); route(); });
    on('submit', async () => { await save(); await act('submit'); toast('CRA soumis pour validation'); route(); });
    on('validate', async () => { await act('validate'); toast('CRA validé'); route(); });
    on('reject', async () => {
      openModal(`<h2>Refuser le CRA</h2><form id="rj"><label class="form" style="display:block"><span style="color:var(--muted);font-size:13px">Motif (visible par le consultant)</span><textarea name="comment" rows="3" required style="width:100%;margin-top:4px"></textarea></label>
        <div class="modal-actions"><button type="button" class="btn" data-close>Annuler</button><button class="btn danger">Refuser</button></div></form>`, (root, close) => {
        $('#rj', root).onsubmit = async e => {
          e.preventDefault();
          try { await act('reject', { comment: new FormData(e.target).get('comment') }); close(); toast('CRA refusé'); route(); } catch (err) { fail(err); }
        };
      });
    });
  }
  render();
}

/* ---------- Démarrage : serveur réel, sinon mode démo ---------- */
async function boot() {
  try {
    const r = await fetch('api/skills');
    const isJson = (r.headers.get('content-type') || '').includes('application/json');
    if (!r.ok || !isJson) throw new Error('pas de serveur');
  } catch {
    demo = window.DemoAPI;
    $('#demoBanner').hidden = false;
    $('#demoReset').onclick = () => { demo.reset(); toast('Démo réinitialisée'); route(); };
  }
  route();
}
boot();
