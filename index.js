const createApp = require('./mini');
const path = require('path');
const fs = require('fs');

// charge .env simplement (sans dépendance)
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const db = require('./db');
const cra = require('./cra-adapter');

// Premier lancement : base vide -> on charge les données de démonstration
if (db.prepare('SELECT COUNT(*) AS n FROM consultants').get().n === 0) require('./seed');

const app = createApp();
app.static(path.join(__dirname, '..', 'public'));

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const parseConsultant = r => r && { ...r, skills: JSON.parse(r.skills || '[]') };
const isMonth = s => /^\d{4}-(0[1-9]|1[0-2])$/.test(s || '');
const currentMonth = () => new Date().toISOString().slice(0, 7);

/* ---------- Consultants (CVthèque) ---------- */
app.get('/api/consultants', (req, res) => {
  const { q, skill, contract, availability, location, tjmMax, expMin } = req.query;
  const where = [];
  const params = [];
  if (q) {
    where.push('(first_name LIKE ? OR last_name LIKE ? OR title LIKE ? OR skills LIKE ?)');
    params.push(...Array(4).fill(`%${q}%`));
  }
  if (skill) {
    for (const s of String(skill).split(',').filter(Boolean)) {
      where.push('skills LIKE ?');
      params.push(`%"${s}"%`);
    }
  }
  if (contract) { where.push('contract = ?'); params.push(contract); }
  if (availability === 'Disponible') where.push("availability LIKE 'Disponible%'");
  if (availability === 'En mission') where.push("availability = 'En mission'");
  if (location) { where.push('location LIKE ?'); params.push(`%${location}%`); }
  if (tjmMax) { where.push('tjm <= ?'); params.push(Number(tjmMax)); }
  if (expMin) { where.push('experience >= ?'); params.push(Number(expMin)); }
  const sql = `SELECT * FROM consultants ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY last_name`;
  res.json(db.prepare(sql).all(...params).map(parseConsultant));
});

app.get('/api/skills', (req, res) => {
  const set = new Set();
  db.prepare('SELECT skills FROM consultants').all().forEach(r => JSON.parse(r.skills).forEach(s => set.add(s)));
  res.json([...set].sort((a, b) => a.localeCompare(b)));
});

app.get('/api/consultants/:id', (req, res) => {
  const c = parseConsultant(db.prepare('SELECT * FROM consultants WHERE id = ?').get(req.params.id));
  if (!c) return res.status(404).json({ error: 'Consultant introuvable' });
  c.missions = db.prepare(`SELECT m.*, cl.name AS client FROM missions m JOIN clients cl ON cl.id = m.client_id
                           WHERE consultant_id = ? ORDER BY start_date DESC`).all(c.id);
  res.json(c);
});

function consultantFields(b) {
  if (!b.first_name || !b.last_name || !b.title) {
    const e = new Error('Prénom, nom et intitulé sont obligatoires.'); e.status = 400; throw e;
  }
  return [b.first_name, b.last_name, b.title, b.contract || 'Freelance', b.tjm || null, b.location || null,
    b.experience || 0, b.availability || 'Disponible', b.available_from || null,
    JSON.stringify(Array.isArray(b.skills) ? b.skills : []), b.email || null, b.phone || null,
    b.summary || null, b.external_cra_id || null];
}

app.post('/api/consultants', (req, res) => {
  const f = consultantFields(req.body);
  const info = db.prepare(`INSERT INTO consultants (first_name,last_name,title,contract,tjm,location,experience,
    availability,available_from,skills,email,phone,summary,external_cra_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(...f);
  res.status(201).json({ id: info.lastInsertRowid });
});

app.put('/api/consultants/:id', (req, res) => {
  const f = consultantFields(req.body);
  db.prepare(`UPDATE consultants SET first_name=?,last_name=?,title=?,contract=?,tjm=?,location=?,experience=?,
    availability=?,available_from=?,skills=?,email=?,phone=?,summary=?,external_cra_id=? WHERE id=?`).run(...f, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/consultants/:id', (req, res) => {
  db.prepare('DELETE FROM consultants WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

/* ---------- Clients ---------- */
app.get('/api/clients', (req, res) => {
  res.json(db.prepare('SELECT * FROM clients ORDER BY name').all());
});
app.post('/api/clients', (req, res) => {
  const { name, sector, contact, email } = req.body;
  if (!name) return res.status(400).json({ error: 'Nom obligatoire' });
  const info = db.prepare('INSERT INTO clients (name,sector,contact,email) VALUES (?,?,?,?)').run(name, sector ?? null, contact ?? null, email ?? null);
  res.status(201).json({ id: info.lastInsertRowid });
});

/* ---------- Missions ---------- */
app.get('/api/missions', (req, res) => {
  res.json(db.prepare(`
    SELECT m.*, c.first_name || ' ' || c.last_name AS consultant, c.title AS consultant_title, c.tjm AS consultant_tjm, cl.name AS client
    FROM missions m JOIN consultants c ON c.id = m.consultant_id JOIN clients cl ON cl.id = m.client_id
    ORDER BY CASE m.status WHEN 'En cours' THEN 0 WHEN 'À venir' THEN 1 ELSE 2 END, m.start_date DESC`).all());
});

app.post('/api/missions', (req, res) => {
  const b = req.body;
  if (!b.consultant_id || !b.client_id || !b.title || !b.start_date || !b.tjm_sold)
    return res.status(400).json({ error: 'Consultant, client, intitulé, date de début et TJM sont obligatoires.' });
  const info = db.prepare(`INSERT INTO missions (consultant_id,client_id,title,start_date,end_date,tjm_sold,status)
    VALUES (?,?,?,?,?,?,?)`).run(b.consultant_id, b.client_id, b.title, b.start_date, b.end_date || null, b.tjm_sold, b.status || 'En cours');
  if ((b.status || 'En cours') === 'En cours')
    db.prepare("UPDATE consultants SET availability = 'En mission', available_from = NULL WHERE id = ?").run(b.consultant_id);
  res.status(201).json({ id: info.lastInsertRowid });
});

app.patch('/api/missions/:id', (req, res) => {
  const m = db.prepare('SELECT * FROM missions WHERE id = ?').get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Mission introuvable' });
  const b = { ...m, ...req.body };
  db.prepare('UPDATE missions SET title=?, end_date=?, tjm_sold=?, status=? WHERE id=?')
    .run(b.title, b.end_date, b.tjm_sold, b.status, m.id);
  if (b.status === 'Terminée')
    db.prepare("UPDATE consultants SET availability = 'Disponible' WHERE id = ?").run(m.consultant_id);
  res.json({ ok: true });
});

/* ---------- CRA ---------- */
// Liste des missions avec leur CRA du mois (vue de validation)
app.get('/api/cra', wrap(async (req, res) => {
  const month = req.query.month || currentMonth();
  if (!isMonth(month)) return res.status(400).json({ error: 'Mois invalide (YYYY-MM).' });
  const missions = db.prepare(`
    SELECT m.id, m.title, m.tjm_sold, c.id AS consultant_id, c.first_name || ' ' || c.last_name AS consultant,
           cl.name AS client
    FROM missions m JOIN consultants c ON c.id = m.consultant_id JOIN clients cl ON cl.id = m.client_id
    WHERE m.status != 'À venir' AND substr(m.start_date,1,7) <= ? AND (m.end_date IS NULL OR substr(m.end_date,1,7) >= ?)`)
    .all(month, month);
  const list = await cra.listCra(month);
  const byMission = Object.fromEntries(list.map(x => [x.missionId, x]));
  res.json(missions.map(m => {
    const x = byMission[m.id];
    return { ...m, month, status: x ? x.status : 'Non saisi', daysWorked: x ? x.daysWorked : 0,
             amount: (x ? x.daysWorked : 0) * m.tjm_sold, comment: x ? x.comment : null };
  }));
}));

app.get('/api/missions/:id/cra/:month', wrap(async (req, res) => {
  if (!isMonth(req.params.month)) return res.status(400).json({ error: 'Mois invalide.' });
  res.json(await cra.getCra(Number(req.params.id), req.params.month));
}));

app.put('/api/missions/:id/cra/:month', wrap(async (req, res) => {
  if (!isMonth(req.params.month)) return res.status(400).json({ error: 'Mois invalide.' });
  res.json(await cra.saveDays(Number(req.params.id), req.params.month, req.body.days || []));
}));

const transitions = {
  submit: ['Soumis', ['Brouillon', 'Refusé']],
  validate: ['Validé', ['Soumis']],
  reject: ['Refusé', ['Soumis']],
};
for (const [action, [target, from]] of Object.entries(transitions)) {
  app.post(`/api/missions/:id/cra/:month/${action}`, wrap(async (req, res) => {
    const current = await cra.getCra(Number(req.params.id), req.params.month);
    if (!from.includes(current.status))
      return res.status(409).json({ error: `Action impossible depuis le statut « ${current.status} ».` });
    res.json(await cra.setStatus(Number(req.params.id), req.params.month, target, req.body.comment || null));
  }));
}

/* ---------- Tableau de bord ---------- */
app.get('/api/dashboard', wrap(async (req, res) => {
  const month = req.query.month || currentMonth();
  if (!isMonth(month)) return res.status(400).json({ error: 'Mois invalide.' });
  const consultants = db.prepare('SELECT availability, contract FROM consultants').all();
  const missions = db.prepare("SELECT COUNT(*) AS n FROM missions WHERE status = 'En cours'").get().n;
  const list = await cra.listCra(month);
  const price = Object.fromEntries(db.prepare('SELECT id, tjm_sold FROM missions').all().map(m => [m.id, m.tjm_sold]));
  let toInvoice = 0, pendingValidation = 0, days = 0, missing = 0;
  for (const x of list) {
    days += x.daysWorked;
    if (x.status === 'Validé') toInvoice += x.daysWorked * price[x.missionId];
    if (x.status === 'Soumis') pendingValidation++;
  }
  const active = db.prepare(`SELECT id FROM missions WHERE status = 'En cours'`).all();
  missing = active.filter(m => !list.find(x => x.missionId === m.id && x.status !== 'Brouillon')).length;
  res.json({
    month,
    consultants: consultants.length,
    available: consultants.filter(c => c.availability.startsWith('Disponible')).length,
    onMission: consultants.filter(c => c.availability === 'En mission').length,
    activeMissions: missions,
    daysWorked: days,
    toInvoice,
    pendingValidation,
    craMissing: missing,
  });
}));

/* ---------- Erreurs ---------- */
app.onError((err, req, res) => {
  if (!err.status) console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Erreur serveur' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Consultant Hub sur http://localhost:${port}`));
