'use strict';

/**
 * Schreibt die Kennungen der Plattform-Anwendungen ins Installationspaket.
 *
 * Läuft bei der Veröffentlichung auf GitHub. Die Werte kommen aus den
 * Repository-Geheimnissen (Settings → Secrets and variables → Actions) und
 * landen in src/main/publish/credentials.local.json – die Datei steht nicht im
 * Repository, wird aber mit in den Installer gepackt. Dadurch meldet sich jeder
 * Nutzer nur noch an, ohne irgendetwas einzutragen.
 *
 * Fehlt ein Geheimnis, bleibt die Plattform einfach „einmalig einrichten“.
 *
 *     node scripts/write-credentials.js
 */

const fs = require('fs');
const path = require('path');

const MAP = {
  google: { clientId: 'CH_GOOGLE_CLIENT_ID', clientSecret: 'CH_GOOGLE_CLIENT_SECRET' },
  tiktok: { clientKey: 'CH_TIKTOK_CLIENT_KEY', clientSecret: 'CH_TIKTOK_CLIENT_SECRET' },
  meta: { appId: 'CH_META_APP_ID', appSecret: 'CH_META_APP_SECRET', configId: 'CH_META_CONFIG_ID' },
  linkedin: { clientId: 'CH_LINKEDIN_CLIENT_ID', clientSecret: 'CH_LINKEDIN_CLIENT_SECRET' },
  x: { clientId: 'CH_X_CLIENT_ID' },
};

const out = {};
const found = [];
for (const [provider, fields] of Object.entries(MAP)) {
  const values = {};
  for (const [field, env] of Object.entries(fields)) {
    const value = String(process.env[env] || '').trim();
    if (value) values[field] = value;
  }
  if (Object.keys(values).length) {
    out[provider] = values;
    found.push(provider);
  }
}

const target = path.join(__dirname, '..', 'src', 'main', 'publish', 'credentials.local.json');
fs.writeFileSync(target, JSON.stringify(out, null, 2), 'utf8');
process.stdout.write(found.length
  ? `Kennungen eingesetzt für: ${found.join(', ')}\n`
  : 'Keine Kennungen hinterlegt – alle Plattformen bleiben „einmalig einrichten“.\n');
