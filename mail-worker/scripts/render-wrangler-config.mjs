import fs from 'node:fs';
import path from 'node:path';

const outputPath = process.argv[2];
if (!outputPath) {
  throw new Error('Usage: node scripts/render-wrangler-config.mjs <output-file>');
}

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const optional = (name, fallback = '') => process.env[name]?.trim() || fallback;

const parseBoolean = (name, fallback = false) => {
  const value = optional(name, String(fallback)).toLowerCase();
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be true or false`);
};

const domainPattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

const normalizeDomain = (value, name) => {
  const domain = value.trim().toLowerCase().replace(/\.$/, '');
  if (!domainPattern.test(domain)) throw new Error(`${name} contains an invalid domain: ${value}`);
  return domain;
};

const parseDomains = (raw) => {
  let values;
  try {
    values = JSON.parse(raw);
  } catch {
    values = raw.split(',');
  }

  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('DOMAIN must be a JSON array or comma-separated domain list');
  }

  return [...new Set(values.map((value) => normalizeDomain(String(value), 'DOMAIN')))];
};

const workerName = optional('WORKER_NAME', 'cloud-mail').toLowerCase();
if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(workerName)) {
  throw new Error('WORKER_NAME must contain only lowercase letters, numbers, and hyphens');
}

const domains = parseDomains(required('DOMAIN'));
const customDomainRaw = optional('CUSTOM_DOMAIN');
const customDomain = customDomainRaw ? normalizeDomain(customDomainRaw, 'CUSTOM_DOMAIN') : '';
const zoneName = normalizeDomain(optional('ZONE_NAME', domains[0]), 'ZONE_NAME');
const admin = required('ADMIN').toLowerCase();

if (!/^[^\s@]+@[^\s@]+$/.test(admin)) throw new Error('ADMIN must be a valid email address');
if (!domains.includes(admin.split('@')[1])) {
  throw new Error('ADMIN must use one of the configured DOMAIN values');
}
if (customDomain && customDomain !== zoneName && !customDomain.endsWith(`.${zoneName}`)) {
  throw new Error('CUSTOM_DOMAIN must belong to ZONE_NAME');
}

const d1DatabaseName = required('D1_DATABASE_NAME');
const d1DatabaseId = required('D1_DATABASE_ID');
const kvNamespaceId = required('KV_NAMESPACE_ID');
const r2Enabled = parseBoolean('R2_ENABLED', false);
const r2BucketName = optional('R2_BUCKET_NAME', `${workerName}-attachments`).toLowerCase();

if (r2Enabled && !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(r2BucketName)) {
  throw new Error('R2_BUCKET_NAME must contain 3-63 lowercase letters, numbers, or hyphens');
}

const config = {
  $schema: './node_modules/wrangler/config-schema.json',
  name: workerName,
  main: 'src/index.js',
  compatibility_date: '2025-06-04',
  workers_dev: true,
  observability: { enabled: true },
  d1_databases: [
    {
      binding: 'db',
      database_name: d1DatabaseName,
      database_id: d1DatabaseId,
    },
  ],
  kv_namespaces: [{ binding: 'kv', id: kvNamespaceId }],
  ai: { binding: 'ai' },
  assets: {
    binding: 'assets',
    directory: './dist',
    not_found_handling: 'single-page-application',
    run_worker_first: true,
  },
  triggers: { crons: ['0 16 * * *'] },
  vars: {
    ai_model: optional('AI_MODEL', '@cf/meta/llama-3.1-8b-instruct'),
    analysis_cache: parseBoolean('ANALYSIS_CACHE', false),
    domain: domains,
    admin,
    project_link: parseBoolean('PROJECT_LINK', false),
  },
};

if (customDomain) {
  config.routes = [{ pattern: customDomain, custom_domain: true }];
}

if (r2Enabled) {
  config.r2_buckets = [{ binding: 'r2', bucket_name: r2BucketName }];
}

if (parseBoolean('CF_EMAIL_ENABLED', false)) {
  config.send_email = [{ name: 'email' }];
}

if (parseBoolean('LINUXDO_SWITCH', false)) {
  config.vars.linuxdo_switch = true;
  config.vars.linuxdo_client_id = required('LINUXDO_CLIENT_ID');
  config.vars.linuxdo_callback_url = required('LINUXDO_CALLBACK_URL');
}

const absoluteOutputPath = path.resolve(outputPath);
fs.writeFileSync(absoluteOutputPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });

console.log(`Rendered Wrangler config for ${workerName}`);
console.log(`Mail domains: ${domains.join(', ')}`);
console.log(`Web route: ${customDomain ? `https://${customDomain}` : 'workers.dev only'}`);
console.log(`R2 enabled: ${r2Enabled}`);
