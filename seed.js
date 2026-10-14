const db = require('./db');

if (db.prepare('SELECT COUNT(*) AS n FROM consultants').get().n > 0 && !process.argv.includes('--force')) {
  console.log('Base déjà remplie. Utilisez `npm run seed -- --force` pour la réinitialiser.');
  process.exit(0);
}

db.exec('DELETE FROM cra_days; DELETE FROM cra; DELETE FROM missions; DELETE FROM consultants; DELETE FROM clients; DELETE FROM sqlite_sequence;');

const clients = [
  ['Banque Atlantique', 'Banque', 'Claire Dubois', 'c.dubois@banque-atlantique.example'],
  ['Assur+', 'Assurance', 'Marc Leroy', 'm.leroy@assurplus.example'],
  ['Mobilix', 'Transport', 'Sophie Martin', 's.martin@mobilix.example'],
  ['Retail Group', 'Distribution', 'Paul Garnier', 'p.garnier@retailgroup.example'],
];
const insClient = db.prepare('INSERT INTO clients (name, sector, contact, email) VALUES (?,?,?,?)');
clients.forEach(c => insClient.run(...c));

const consultants = [
  ['Camille', 'Bernard', 'Développeuse Full Stack Java / Angular', 'Freelance', 650, 'Paris', 8, 'En mission', null, ['Java', 'Spring', 'Angular', 'PostgreSQL', 'Docker']],
  ['Thomas', 'Petit', 'Architecte Cloud AWS', 'Freelance', 850, 'Lyon', 14, 'Disponible', null, ['AWS', 'Terraform', 'Kubernetes', 'Python']],
  ['Inès', 'Moreau', 'Data Engineer', 'CDI', 600, 'Paris', 6, 'En mission', null, ['Python', 'Spark', 'Airflow', 'Snowflake', 'SQL']],
  ['Lucas', 'Roux', 'Chef de projet SI', 'Freelance', 700, 'Nantes', 12, 'Disponible le 2026-11-15', '2026-11-15', ['PMO', 'Agile', 'SAFe', 'Jira']],
  ['Sarah', 'Lambert', 'Développeuse Front React', 'CDI', 520, 'Lille', 4, 'Disponible', null, ['React', 'TypeScript', 'Next.js', 'Jest']],
  ['Karim', 'Benali', 'DevOps / SRE', 'Freelance', 750, 'Paris', 10, 'En mission', null, ['Kubernetes', 'GitLab CI', 'Terraform', 'Prometheus', 'Linux']],
  ['Émilie', 'Faure', 'Product Owner', 'CDI', 580, 'Bordeaux', 7, 'Disponible', null, ['Product Owner', 'Agile', 'UX', 'Jira']],
  ['Nicolas', 'Girard', 'Développeur Back .NET', 'Freelance', 600, 'Toulouse', 9, 'Disponible', null, ['.NET', 'C#', 'Azure', 'SQL Server']],
];
const insCons = db.prepare(`INSERT INTO consultants
  (first_name,last_name,title,contract,tjm,location,experience,availability,available_from,skills,email,phone,summary,external_cra_id)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
consultants.forEach((c, i) => {
  const [fn, ln, title, contract, tjm, loc, exp, avail, from, skills] = c;
  insCons.run(fn, ln, title, contract, tjm, loc, exp, avail, from, JSON.stringify(skills),
    `${fn}.${ln}@exemple.fr`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''),
    `06 00 00 00 ${String(10 + i).padStart(2, '0')}`,
    `${title} avec ${exp} ans d'expérience. Compétences clés : ${skills.slice(0, 3).join(', ')}.`,
    `EXT-${1000 + i}`);
});

// Missions : [consultant_id, client_id, titre, début, fin, tjm vendu, statut]
const missions = [
  [1, 1, 'Refonte portail clients', '2026-03-01', null, 760, 'En cours'],
  [3, 2, 'Plateforme data sinistres', '2026-05-04', null, 700, 'En cours'],
  [6, 3, 'Industrialisation CI/CD', '2026-01-12', null, 880, 'En cours'],
  [2, 4, 'Migration vers AWS', '2025-09-01', '2026-08-31', 980, 'Terminée'],
  [4, 1, 'PMO programme réglementaire', '2026-11-16', null, 820, 'À venir'],
];
const insM = db.prepare('INSERT INTO missions (consultant_id,client_id,title,start_date,end_date,tjm_sold,status) VALUES (?,?,?,?,?,?,?)');
missions.forEach(m => insM.run(...m));

// CRA : septembre (validé) et octobre (en cours) pour les missions actives
const insCra = db.prepare('INSERT INTO cra (mission_id, month, status, comment) VALUES (?,?,?,?)');
const insDay = db.prepare('INSERT INTO cra_days (cra_id, day, value, kind) VALUES (?,?,?,?)');

function workdays(month, upTo) {
  const [y, m] = month.split('-').map(Number);
  const out = [];
  const last = new Date(y, m, 0).getDate();
  for (let d = 1; d <= Math.min(last, upTo); d++) {
    const dt = new Date(Date.UTC(y, m - 1, d));
    const wd = dt.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(`${month}-${String(d).padStart(2, '0')}`);
  }
  return out;
}

[1, 2, 3].forEach(missionId => {
  const sep = insCra.run(missionId, '2026-09', 'Validé', null).lastInsertRowid;
  workdays('2026-09', 31).forEach((day, i) => {
    if (missionId === 2 && i === 10) insDay.run(sep, day, 1, 'Congé');
    else insDay.run(sep, day, 1, 'Travaillé');
  });
  const status = missionId === 1 ? 'Soumis' : 'Brouillon';
  const oct = insCra.run(missionId, '2026-10', status, null).lastInsertRowid;
  workdays('2026-10', 13).forEach(day => insDay.run(oct, day, 1, 'Travaillé'));
});

console.log('Base initialisée avec des données de démonstration.');
