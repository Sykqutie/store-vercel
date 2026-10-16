'use strict';
// SmartMart local backup utility (store computer only).
//
//   npm run backup          create a manual backup in the backup folder
//   npm run backup -- --kind=daily    create a daily-kind backup (Task Scheduler)
//   npm run backup:list     list available backups
//
// Needs DATABASE_URL in .env. Uses lib/backup.js directly (no HTTP, no login
// needed — anyone able to run this already controls the server, same trust
// model as scripts/recover-owner.js). Never prints credentials or data.
const backup = require('../lib/backup');

function arg(name) {
  const p = process.argv.find((a) => a === name || a.startsWith(name + '='));
  if (!p) return null;
  const i = p.indexOf('=');
  return i === -1 ? true : p.slice(i + 1);
}

async function main() {
  const cmd = process.argv[2] || 'create';
  if (cmd === 'list') {
    const all = backup.listBackups();
    if (!all.length) {
      console.log('No backups in ' + backup.backupDir());
      return;
    }
    for (const b of all) {
      console.log(`${b.valid ? 'OK  ' : 'BAD '} ${b.file}  ${(b.size / 1024).toFixed(1)} KB  ${b.created_at}` +
        (b.counts ? `  users=${b.counts.users} products=${b.counts.products} sales=${b.counts.sales}` : ''));
    }
    return;
  }
  if (cmd === 'prune') {
    const r = backup.pruneBackups();
    console.log(r.deleted.length ? 'Deleted: ' + r.deleted.join(', ') : 'Nothing to prune.');
    return;
  }
  if (cmd === 'create') {
    const kind = ['manual', 'daily', 'weekly'].includes(arg('--kind')) ? arg('--kind') : 'manual';
    const created = await backup.writeBackup(kind);
    console.log(`Backup created and verified: ${created.file} (${(created.size / 1024).toFixed(1)} KB)`);
    console.log(`Counts: users=${created.counts.users} products=${created.counts.products} ` +
      `sales=${created.counts.sales} items=${created.counts.sale_items} movements=${created.counts.stock_movements}`);
    if (backup.isEphemeral()) {
      console.log('NOTE: this filesystem is ephemeral — download the backup to an external drive now.');
    } else {
      console.log('Stored in: ' + backup.backupDir());
      console.log('Keep a copy outside this computer (external drive or secure cloud storage).');
    }
    return;
  }
  console.log('Usage: node scripts/backup.js [create [--kind=manual|daily|weekly] | list | prune]');
  process.exitCode = 1;
}

main().catch((e) => {
  console.error('ERROR: ' + (e && e.message ? String(e.message).split('\n')[0] : e));
  process.exitCode = 1;
});
