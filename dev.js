'use strict';
// Local development server: same pages and API as the Vercel deployment.
//   cp .env.example .env   (fill in DATABASE_URL and AUTH_SECRET)
//   npm install && npm run dev
const express = require('express');
const path = require('path');
const app = require('./api/index.js');

const PAGES = {
  '/': 'index', '/login': 'login', '/install': 'install', '/dashboard': 'dashboard', '/pos': 'pos',
  '/cashier': 'pos', // cashier landing alias: serves the existing POS checkout page (no duplicate page)
  '/products': 'products', '/inventory': 'products', '/edit-product': 'edit-product', '/report': 'report', '/receipt': 'receipt', '/users': 'users', '/backup': 'backup', '/offline': 'offline',
  '/forgot-password': 'forgot-password', // public owner-recovery info page (no reset endpoint; see scripts/recover-owner.js)
};

const root = express();
root.use(app); // handles /api/*; other paths fall through
// Correct MIME + SW headers for local PWA testing (Vercel sets these via vercel.json).
root.use('/manifest.webmanifest', (req, res, next) => {
  res.setHeader('Content-Type', 'application/manifest+json');
  next();
});
root.use('/sw.js', (req, res, next) => {
  res.setHeader('Service-Worker-Allowed', '/');
  res.setHeader('Cache-Control', 'no-cache');
  next();
});
root.use(express.static(path.join(__dirname, 'public')));
root.get(Object.keys(PAGES), (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'html', PAGES[req.path] + '.html'));
});

// Local automatic backups (store computer only — never on Vercel).
// Set BACKUP_AUTO=daily|weekly in .env and keep this server running.
// Windows Task Scheduler calling `npm run backup` works even when the
// server is off; see the README backup section.
(function autoBackup() {
  if (process.env.VERCEL) return;
  const mode = process.env.BACKUP_AUTO || 'off';
  if (mode !== 'daily' && mode !== 'weekly') return;
  const backup = require('./lib/backup');
  const dayKey = (d) => d.toISOString().slice(0, 10);
  const weekKey = (d) => {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = (t.getUTCDay() + 6) % 7;
    t.setUTCDate(t.getUTCDate() - day + 3);
    const first = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
    const fday = (first.getUTCDay() + 6) % 7;
    first.setUTCDate(first.getUTCDate() - fday + 3);
    return t.getUTCFullYear() + '-W' + String(1 + Math.round((t - first) / 6048e5)).padStart(2, '0');
  };
  const due = () => {
    try {
      const now = new Date();
      const have = backup.listBackups().filter((b) => b.valid && b.kind === mode);
      if (mode === 'daily') return !have.some((b) => dayKey(new Date(b.created_at)) === dayKey(now));
      return !have.some((b) => weekKey(new Date(b.created_at)) === weekKey(now));
    } catch (_) {
      return false;
    }
  };
  const run = async () => {
    if (!due()) return;
    try {
      const c = await backup.writeBackup(mode);
      console.log(`Auto-backup (${mode}) created: ${c.file}`);
    } catch (e) {
      console.error('Auto-backup failed:', (e && e.message) || e);
    }
  };
  setTimeout(run, 15000); // first check shortly after startup
  setInterval(run, 60 * 60 * 1000); // then hourly
  console.log(`Auto-backup enabled (${mode}).`);
})();

const port = process.env.PORT || 3000;
if (require.main === module) {
  root.listen(port, () => console.log(`Store running at http://localhost:${port}`));
}
module.exports = root;
