/* Mode démo : même API que le serveur, mais en mémoire + localStorage du navigateur.
   Activé automatiquement quand aucun serveur n'est joignable (ex. GitHub Pages). */
(function () {
  const KEY = 'consultant-hub-demo-v1';

  const err = (status, message) => Object.assign(new Error(message), { status });

  function workdays(month, upTo) {
    const [y, m] = month.split('-').map(Number);
    const out = [];
    const last = new Date(y, m, 0).getDate();
    for (let d = 1; d <= Math.min(last, upTo); d++) {
      const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
      if (wd !== 0 && wd !== 6) out.push(`${month}-${String(d).padStart(2, '0')}`);
    }
    return out;
  }

  function seed() {
    const clients = [
      ['Banque Atlantique', 'Banque', 'Claire Dubois', 'c.dubois@banque-atlantique.example'],
      ['Assur+', 'Assurance', 'Marc Leroy', 'm.leroy@assurplus.example'],
      ['Mobilix', 'Transport', 'Sophie Martin', 's.martin@mobilix.example'],
      ['Retail Group', 'Distribution', 'Paul Garnier', 'p.garnier@retailgroup.example'],
    ].map(([name, sector, contact, email], i) => ({ id: i + 1, name, sector, contact, email }));

    const raw = [
      ['Camille', 'Bernard', 'Développeuse Full Stack Java / Angular', 'Freelance', 650, 'Paris', 8, 'En mission', null, ['Java', 'Spring', 'Angular', 'PostgreSQL', 'Docker']],
      ['Thomas', 'Petit', 'Architecte Cloud AWS', 'Freelance', 850, 'Lyon', 14, 'Disponible', null, ['AWS', 'Terraform', 'Kubernetes', 'Python']],
      ['Inès', 'Moreau', 'Data Engineer', 'CDI', 600, 'Paris', 6, 'En mission', null, ['Python', 'Spark', 'Airflow', 'Snowflake', 'SQL']],
      ['Lucas', 'Roux', 'Chef de projet SI', 'Freelance', 700, 'Nantes', 12, 'Disponible le 2026-11-15', '2026-11-15', ['PMO', 'Agile', 'SAFe', 'Jira']],
      ['Sarah', 'Lambert', 'Développeuse Front React', 'CDI', 520, 'Lille', 4, 'Disponible', null, ['React', 'TypeScript', 'Next.js', 'Jest']],
      ['Karim', 'Benali', 'DevOps / SRE', 'Freelance', 750, 'Paris', 10, 'En mission', null, ['Kubernetes', 'GitLab CI', 'Terraform', 'Prometheus', 'Linux']],
      ['Émilie', 'Faure', 'Product Owner', 'CDI', 580, 'Bordeaux', 7, 'Disponible', null, ['Product Owner', 'Agile', 'UX', 'Jira']],
      ['Nicolas', 'Girard', 'Développeur Back .NET', 'Freelance', 600, 'Toulouse', 9, 'Disponible', null, ['.NET', 'C#', 'Azure', 'SQL Server']],
    ];
    const consultants = raw.map(([first_name, last_name, title, contract, tjm, location, experience, availability, available_from, skills], i) => ({
      id: i + 1, first_name, last_name, title, contract, tjm, location, experience, availability, available_from, skills,
      email: `${first_name}.${last_name}@exemple.fr`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''),
      phone: `06 00 00 00 ${String(10 + i).padStart(2, '0')}`,
      summary: `${title} avec ${experience} ans d'expérience. Compétences clés : ${skills.slice(0, 3).join(', ')}.`,
      external_cra_id: `EXT-${1000 + i}`,
    }));

    const missions = [
      [1, 1, 'Refonte portail clients', '2026-03-01', null, 760, 'En cours'],
      [3, 2, 'Plateforme data sinistres', '2026-05-04', null, 700, 'En cours'],
      [6, 3, 'Industrialisation CI/CD', '2026-01-12', null, 880, 'En cours'],
      [2, 4, 'Migration vers AWS', '2025-09-01', '2026-08-31', 980, 'Terminée'],
      [4, 1, 'PMO programme réglementaire', '2026-11-16', null, 820, 'À venir'],
    ].map(([consultant_id, client_id, title, start_date, end_date, tjm_sold, status], i) =>
      ({ id: i + 1, consultant_id, client_id, title, start_date, end_date, tjm_sold, status }));

    const cra = [];
    let craId = 1;
    [1, 2, 3].forEach(missionId => {
      const sep = { id: craId++, mission_id: missionId, month: '2026-09', status: 'Validé', comment: null, days: [] };
      workdays('2026-09', 31).forEach((day, i) =>
        sep.days.push({ day, value: 1, kind: missionId === 2 && i === 10 ? 'Congé' : 'Travaillé' }));
      cra.push(sep);
      cra.push({
        id: craId++, mission_id: missionId, month: '2026-10', status: missionId === 1 ? 'Soumis' : 'Brouillon', comment: null,
        days: workdays('2026-10', 13).map(day => ({ day, value: 1, kind: 'Travaillé' })),
      });
    });

    return { clients, consultants, missions, cra, seq: { clients: 5, consultants: 9, missions: 6, cra: craId } };
  }

  let db;
  function load() {
    try { db = JSON.parse(localStorage.getItem(KEY)); } catch { db = null; }
    if (!db || !db.consultants) db = seed();
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* stockage indisponible : démo non persistante */ } }
  load();

  const clone = x => JSON.parse(JSON.stringify(x));
  const isMonth = s => /^\d{4}-(0[1-9]|1[0-2])$/.test(s || '');
  const currentMonth = () => new Date().toISOString().slice(0, 7);
  const has = (hay, needle) => String(hay).toLowerCase().includes(String(needle).toLowerCase());

  function getCra(missionId, month) {
    let c = db.cra.find(x => x.mission_id === missionId && x.month === month);
    if (!c) {
      c = { id: db.seq.cra++, mission_id: missionId, month, status: 'Brouillon', comment: null, days: [] };
      db.cra.push(c);
    }
    return c;
  }
  const craOut = c => ({ id: c.id, missionId: c.mission_id, month: c.month, status: c.status, comment: c.comment,
    days: [...c.days].sort((a, b) => a.day.localeCompare(b.day)) });
  const worked = c => c.days.filter(d => d.kind === 'Travaillé').reduce((s, d) => s + d.value, 0);

  function consultantFields(b) {
    if (!b.first_name || !b.last_name || !b.title) throw err(400, 'Prénom, nom et intitulé sont obligatoires.');
    return {
      first_name: b.first_name, last_name: b.last_name, title: b.title, contract: b.contract || 'Freelance',
      tjm: b.tjm || null, location: b.location || null, experience: b.experience || 0,
      availability: b.availability || 'Disponible', available_from: b.available_from || null,
      skills: Array.isArray(b.skills) ? b.skills : [], email: b.email || null, phone: b.phone || null,
      summary: b.summary || null, external_cra_id: b.external_cra_id || null,
    };
  }

  function handle(method, rawPath, body = {}) {
    const url = new URL(rawPath, 'http://demo');
    const q = Object.fromEntries(url.searchParams);
    const p = url.pathname.replace(/\/$/, '');
    let m;
    const out = r => { save(); return clone(r); };

    /* Consultants */
    if (method === 'GET' && p === '/consultants') {
      let rows = db.consultants.filter(c => {
        if (q.q && !has([c.first_name, c.last_name, c.title, JSON.stringify(c.skills)].join(' '), q.q)) return false;
        if (q.skill && !String(q.skill).split(',').filter(Boolean).every(s => c.skills.some(k => k.toLowerCase() === s.toLowerCase()))) return false;
        if (q.contract && c.contract !== q.contract) return false;
        if (q.availability === 'Disponible' && !c.availability.startsWith('Disponible')) return false;
        if (q.availability === 'En mission' && c.availability !== 'En mission') return false;
        if (q.location && !has(c.location || '', q.location)) return false;
        if (q.tjmMax && !(c.tjm <= Number(q.tjmMax))) return false;
        if (q.expMin && !(c.experience >= Number(q.expMin))) return false;
        return true;
      });
      rows.sort((a, b) => a.last_name.localeCompare(b.last_name, 'fr'));
      return out(rows);
    }
    if (method === 'GET' && p === '/skills') {
      return out([...new Set(db.consultants.flatMap(c => c.skills))].sort((a, b) => a.localeCompare(b, 'fr')));
    }
    if (method === 'POST' && p === '/consultants') {
      const c = { id: db.seq.consultants++, ...consultantFields(body) };
      db.consultants.push(c);
      return out({ id: c.id });
    }
    if ((m = p.match(/^\/consultants\/(\d+)$/))) {
      const id = Number(m[1]);
      const c = db.consultants.find(x => x.id === id);
      if (method === 'GET') {
        if (!c) throw err(404, 'Consultant introuvable');
        const ms = db.missions.filter(x => x.consultant_id === id)
          .map(x => ({ ...x, client: (db.clients.find(cl => cl.id === x.client_id) || {}).name }))
          .sort((a, b) => b.start_date.localeCompare(a.start_date));
        return out({ ...c, missions: ms });
      }
      if (method === 'PUT') { if (c) Object.assign(c, consultantFields(body)); return out({ ok: true }); }
      if (method === 'DELETE') {
        db.consultants = db.consultants.filter(x => x.id !== id);
        const gone = db.missions.filter(x => x.consultant_id === id).map(x => x.id);
        db.missions = db.missions.filter(x => x.consultant_id !== id);
        db.cra = db.cra.filter(x => !gone.includes(x.mission_id));
        return out({ ok: true });
      }
    }

    /* Clients */
    if (method === 'GET' && p === '/clients') return out([...db.clients].sort((a, b) => a.name.localeCompare(b.name, 'fr')));
    if (method === 'POST' && p === '/clients') {
      if (!body.name) throw err(400, 'Nom obligatoire');
      const c = { id: db.seq.clients++, name: body.name, sector: body.sector ?? null, contact: body.contact ?? null, email: body.email ?? null };
      db.clients.push(c);
      return out({ id: c.id });
    }

    /* Missions */
    if (method === 'GET' && p === '/missions') {
      const order = { 'En cours': 0, 'À venir': 1 };
      const rows = db.missions.map(x => {
        const c = db.consultants.find(k => k.id === x.consultant_id) || {};
        return { ...x, consultant: `${c.first_name} ${c.last_name}`, consultant_title: c.title, consultant_tjm: c.tjm,
          client: (db.clients.find(cl => cl.id === x.client_id) || {}).name };
      }).sort((a, b) => (order[a.status] ?? 2) - (order[b.status] ?? 2) || b.start_date.localeCompare(a.start_date));
      return out(rows);
    }
    if (method === 'POST' && p === '/missions') {
      if (!body.consultant_id || !body.client_id || !body.title || !body.start_date || !body.tjm_sold)
        throw err(400, 'Consultant, client, intitulé, date de début et TJM sont obligatoires.');
      const x = { id: db.seq.missions++, consultant_id: Number(body.consultant_id), client_id: Number(body.client_id), title: body.title,
        start_date: body.start_date, end_date: body.end_date || null, tjm_sold: Number(body.tjm_sold), status: body.status || 'En cours' };
      db.missions.push(x);
      if (x.status === 'En cours') {
        const c = db.consultants.find(k => k.id === x.consultant_id);
        if (c) { c.availability = 'En mission'; c.available_from = null; }
      }
      return out({ id: x.id });
    }
    if (method === 'PATCH' && (m = p.match(/^\/missions\/(\d+)$/))) {
      const x = db.missions.find(k => k.id === Number(m[1]));
      if (!x) throw err(404, 'Mission introuvable');
      Object.assign(x, body);
      if (x.status === 'Terminée') {
        const c = db.consultants.find(k => k.id === x.consultant_id);
        if (c) c.availability = 'Disponible';
      }
      return out({ ok: true });
    }

    /* CRA */
    if (method === 'GET' && p === '/cra') {
      const month = q.month || currentMonth();
      if (!isMonth(month)) throw err(400, 'Mois invalide (YYYY-MM).');
      const rows = db.missions
        .filter(x => x.status !== 'À venir' && x.start_date.slice(0, 7) <= month && (!x.end_date || x.end_date.slice(0, 7) >= month))
        .map(x => {
          const c = db.consultants.find(k => k.id === x.consultant_id) || {};
          const cr = db.cra.find(k => k.mission_id === x.id && k.month === month);
          const days = cr ? worked(cr) : 0;
          return { id: x.id, title: x.title, tjm_sold: x.tjm_sold, consultant_id: x.consultant_id,
            consultant: `${c.first_name} ${c.last_name}`, client: (db.clients.find(cl => cl.id === x.client_id) || {}).name,
            month, status: cr ? cr.status : 'Non saisi', daysWorked: days, amount: days * x.tjm_sold, comment: cr ? cr.comment : null };
        });
      return out(rows);
    }
    if ((m = p.match(/^\/missions\/(\d+)\/cra\/([^/]+)(?:\/(submit|validate|reject))?$/))) {
      const missionId = Number(m[1]), month = m[2], action = m[3];
      if (!isMonth(month)) throw err(400, 'Mois invalide.');
      const c = getCra(missionId, month);
      if (method === 'GET' && !action) return out(craOut(c));
      if (method === 'PUT' && !action) {
        if (c.status === 'Validé') throw err(409, 'CRA déjà validé : modification impossible.');
        c.days = (body.days || []).filter(d =>
          /^\d{4}-\d{2}-\d{2}$/.test(d.day) && d.day.startsWith(month) && [0, 0.5, 1].includes(Number(d.value)) &&
          !(Number(d.value) === 0 && (d.kind || 'Travaillé') === 'Travaillé'))
          .map(d => ({ day: d.day, value: Number(d.value), kind: d.kind || 'Travaillé' }));
        if (c.status === 'Refusé') c.status = 'Brouillon';
        return out(craOut(c));
      }
      if (method === 'POST' && action) {
        const t = { submit: ['Soumis', ['Brouillon', 'Refusé']], validate: ['Validé', ['Soumis']], reject: ['Refusé', ['Soumis']] }[action];
        if (!t[1].includes(c.status)) throw err(409, `Action impossible depuis le statut « ${c.status} ».`);
        c.status = t[0];
        c.comment = body.comment || null;
        return out(craOut(c));
      }
    }

    /* Tableau de bord */
    if (method === 'GET' && p === '/dashboard') {
      const month = q.month || currentMonth();
      if (!isMonth(month)) throw err(400, 'Mois invalide.');
      const list = db.cra.filter(c => c.month === month);
      const price = Object.fromEntries(db.missions.map(x => [x.id, x.tjm_sold]));
      let days = 0, toInvoice = 0, pendingValidation = 0;
      for (const c of list) {
        const w = worked(c);
        days += w;
        if (c.status === 'Validé') toInvoice += w * price[c.mission_id];
        if (c.status === 'Soumis') pendingValidation++;
      }
      const active = db.missions.filter(x => x.status === 'En cours');
      return out({
        month,
        consultants: db.consultants.length,
        available: db.consultants.filter(c => c.availability.startsWith('Disponible')).length,
        onMission: db.consultants.filter(c => c.availability === 'En mission').length,
        activeMissions: active.length,
        daysWorked: days, toInvoice, pendingValidation,
        craMissing: active.filter(x => !list.find(c => c.mission_id === x.id && c.status !== 'Brouillon')).length,
      });
    }

    throw err(404, 'Route inconnue');
  }

  window.DemoAPI = {
    handle: (method, path, body) => Promise.resolve().then(() => handle(method, path, body)),
    reset() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } db = seed(); save(); },
  };
})();
