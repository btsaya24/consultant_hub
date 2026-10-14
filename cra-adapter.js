/**
 * Adaptateur CRA
 * --------------
 * Le reste de l'application ne parle qu'à cette interface :
 *
 *   getCra(missionId, month)            -> { id, missionId, month, status, comment, days: [{day, value, kind}] }
 *   saveDays(missionId, month, days)    -> CRA mis à jour
 *   setStatus(missionId, month, status, comment) -> CRA mis à jour
 *   listCra(month)                      -> liste de CRA (avec total de jours) pour un mois
 *
 * Deux implémentations :
 *   - local : stocke dans SQLite (par défaut)
 *   - http  : appelle l'API de votre CRA maison. Adaptez les URL / formats dans
 *             la section "HTTP" ci-dessous pour coller à votre API.
 */
const db = require('./db');

const STATUSES = ['Brouillon', 'Soumis', 'Validé', 'Refusé'];

/* ---------- LOCAL (SQLite) ---------- */
const local = {
  async getCra(missionId, month) {
    let row = db.prepare('SELECT * FROM cra WHERE mission_id = ? AND month = ?').get(missionId, month);
    if (!row) {
      const info = db.prepare('INSERT INTO cra (mission_id, month) VALUES (?, ?)').run(missionId, month);
      row = db.prepare('SELECT * FROM cra WHERE id = ?').get(info.lastInsertRowid);
    }
    const days = db.prepare('SELECT day, value, kind FROM cra_days WHERE cra_id = ? ORDER BY day').all(row.id);
    return { id: row.id, missionId: row.mission_id, month: row.month, status: row.status, comment: row.comment, days };
  },

  async saveDays(missionId, month, days) {
    const cra = await this.getCra(missionId, month);
    if (cra.status === 'Validé') throw httpError(409, 'CRA déjà validé : modification impossible.');
    const del = db.prepare('DELETE FROM cra_days WHERE cra_id = ?');
    const ins = db.prepare('INSERT INTO cra_days (cra_id, day, value, kind) VALUES (?, ?, ?, ?)');
    db.transaction(() => {
      del.run(cra.id);
      for (const d of days) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d.day) || !d.day.startsWith(month)) continue;
        const value = Number(d.value);
        if (![0, 0.5, 1].includes(value)) continue;
        if (value === 0 && d.kind === 'Travaillé') continue;
        ins.run(cra.id, d.day, value, d.kind || 'Travaillé');
      }
      // une modification d'un CRA refusé le repasse en brouillon
      if (cra.status === 'Refusé') db.prepare("UPDATE cra SET status = 'Brouillon' WHERE id = ?").run(cra.id);
    })();
    return this.getCra(missionId, month);
  },

  async setStatus(missionId, month, status, comment = null) {
    if (!STATUSES.includes(status)) throw httpError(400, 'Statut invalide.');
    const cra = await this.getCra(missionId, month);
    db.prepare('UPDATE cra SET status = ?, comment = ? WHERE id = ?').run(status, comment, cra.id);
    return this.getCra(missionId, month);
  },

  async listCra(month) {
    return db.prepare(`
      SELECT c.id, c.mission_id AS missionId, c.month, c.status, c.comment,
             COALESCE(SUM(CASE WHEN d.kind = 'Travaillé' THEN d.value END), 0) AS daysWorked
      FROM cra c LEFT JOIN cra_days d ON d.cra_id = c.id
      WHERE c.month = ?
      GROUP BY c.id`).all(month);
  },
};

/* ---------- HTTP (votre CRA maison) ---------- */
const http = {
  async call(method, path, body) {
    const res = await fetch(`${process.env.CRA_API_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.CRA_API_TOKEN}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw httpError(res.status, `API CRA : ${res.status} ${await res.text()}`);
    return res.json();
  },
  // À ADAPTER : routes et formats de votre API CRA.
  getCra: (missionId, month) => http.call('GET', `/missions/${missionId}/cra/${month}`),
  saveDays: (missionId, month, days) => http.call('PUT', `/missions/${missionId}/cra/${month}/days`, { days }),
  setStatus: (missionId, month, status, comment) =>
    http.call('POST', `/missions/${missionId}/cra/${month}/status`, { status, comment }),
  listCra: (month) => http.call('GET', `/cra?month=${month}`),
};

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

module.exports = (process.env.CRA_MODE || 'local') === 'http' ? http : local;
module.exports.STATUSES = STATUSES;
module.exports.httpError = httpError;
