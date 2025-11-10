import express from 'express';
import Database from 'better-sqlite3';

const app = express();
const db = new Database('data.db');

db.pragma('journal_mode = WAL');
db.prepare(`
  CREATE TABLE IF NOT EXISTS scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    score INTEGER NOT NULL,
    timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`).run();

const insertScore = db.prepare('INSERT INTO scores (name, score) VALUES (?, ?)');
const selectTop = db.prepare(
  'SELECT id, name, score, timestamp FROM scores ORDER BY score DESC, timestamp ASC LIMIT 20'
);

app.use(express.json());

function isValidName(name) {
  return typeof name === 'string' && name.trim().length >= 1 && name.trim().length <= 20;
}

function isValidScore(score) {
  return Number.isInteger(score) && score > 0 && score <= 999999;
}

app.post('/submit', (req, res) => {
  const { name, score } = req.body ?? {};
  if (!isValidName(name) || !isValidScore(score)) {
    return res.status(400).json({ error: 'Invalid name or score.' });
  }

  const cleanName = name.trim();
  insertScore.run(cleanName, score);
  res.status(201).json({ ok: true });
});

app.get('/leaders', (_req, res) => {
  res.json(selectTop.all());
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Leaderboard server running on port ${port}`);
});
