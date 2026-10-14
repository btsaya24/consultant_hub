// SQLite via le module intégré de Node (>= 22.5) : aucune dépendance à installer.
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 5)) {
  console.error(
    `\nNode ${process.versions.node} détecté : Consultant Hub nécessite Node 22.5 ou plus récent.\n` +
    `→ Installez-le depuis https://nodejs.org (version LTS), puis relancez « npm start ».\n` +
    `→ En attendant, vous pouvez ouvrir public/index.html dans votre navigateur (version démo).\n`);
  process.exit(1);
}
// masque l'avertissement « SQLite is an experimental feature »
const emit = process.emitWarning;
process.emitWarning = function (w, ...args) {
  const type = typeof args[0] === 'string' ? args[0] : args[0] && args[0].type;
  if (type === 'ExperimentalWarning') return;
  return emit.call(process, w, ...args);
};
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const db = new DatabaseSync(process.env.DB_FILE || path.join(__dirname, '..', 'data.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sector TEXT,
  contact TEXT,
  email TEXT
);

CREATE TABLE IF NOT EXISTS consultants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  title TEXT NOT NULL,
  contract TEXT NOT NULL DEFAULT 'Freelance',   -- Freelance | CDI
  tjm INTEGER,                                    -- taux journalier moyen (EUR)
  location TEXT,
  experience INTEGER DEFAULT 0,                   -- années d'expérience
  availability TEXT NOT NULL DEFAULT 'Disponible',-- Disponible | En mission | Disponible le <date>
  available_from TEXT,
  skills TEXT NOT NULL DEFAULT '[]',              -- JSON array
  email TEXT,
  phone TEXT,
  summary TEXT,
  external_cra_id TEXT                            -- identifiant dans votre CRA maison
);

CREATE TABLE IF NOT EXISTS missions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  consultant_id INTEGER NOT NULL REFERENCES consultants(id) ON DELETE CASCADE,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  title TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT,
  tjm_sold INTEGER NOT NULL,                      -- TJM vendu au client
  status TEXT NOT NULL DEFAULT 'En cours'         -- En cours | Terminée | À venir
);

CREATE TABLE IF NOT EXISTS cra (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mission_id INTEGER NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  month TEXT NOT NULL,                            -- YYYY-MM
  status TEXT NOT NULL DEFAULT 'Brouillon',       -- Brouillon | Soumis | Validé | Refusé
  comment TEXT,
  UNIQUE (mission_id, month)
);

CREATE TABLE IF NOT EXISTS cra_days (
  cra_id INTEGER NOT NULL REFERENCES cra(id) ON DELETE CASCADE,
  day TEXT NOT NULL,                              -- YYYY-MM-DD
  value REAL NOT NULL,                            -- 1, 0.5, 0
  kind TEXT NOT NULL DEFAULT 'Travaillé',         -- Travaillé | Congé | Absence
  PRIMARY KEY (cra_id, day)
);
`);

// Petit utilitaire de transaction (même usage que better-sqlite3)
db.transaction = fn => (...args) => {
  db.exec('BEGIN');
  try {
    const out = fn(...args);
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
};

module.exports = db;
