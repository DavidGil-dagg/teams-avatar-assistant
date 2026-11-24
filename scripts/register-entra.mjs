/**
 * Crea o actualiza el registro de app de Microsoft Entra ID para el asistente
 * (login web + SSO de Teams). Usa la CLI de Azure (`az login` antes).
 *
 *   pnpm entra:register <FQDN> [nombre] [--secret]
 *
 * Ejemplo: pnpm entra:register asistente.contoso.com "Teams Assistant (dev)" --secret
 *
 * Es idempotente: si ya existe una app con ese nombre, la actualiza. Imprime
 * las variables para `.env`. Con `--secret` crea además un secreto de cliente
 * y lo imprime UNA sola vez (guárdalo en `.env` o en Key Vault).
 *
 * Este script cambia tu tenant: revísalo antes de ejecutarlo.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const withSecret = args.includes('--secret');
const [fqdnArg, nameArg] = args.filter((arg) => !arg.startsWith('--'));
if (!fqdnArg) {
  console.error('Uso: pnpm entra:register <FQDN> [nombre] [--secret]');
  process.exit(1);
}
const FQDN = fqdnArg.replace(/^https?:\/\//, '').replace(/\/+$/, '');
const NAME = nameArg ?? 'Teams Assistant (dev)';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const work = mkdtempSync(path.join(tmpdir(), 'entra-register-'));

function az(azArgs, body) {
  const full = [...azArgs, '-o', 'json'];
  if (body !== undefined) {
    const file = path.join(work, `${randomUUID()}.json`);
    writeFileSync(file, JSON.stringify(body));
    full.push('--body', `@${file}`, '--headers', 'Content-Type=application/json');
  }
  try {
    // En Windows `az` es un .cmd: necesita shell, y entonces los argumentos se citan aquí.
    const windows = process.platform === 'win32';
    const quote = (value) =>
      windows && /[\s'"&|<>^()]/.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value;
    const out = execFileSync('az', full.map(quote), {
      encoding: 'utf8',
      shell: windows,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return out.trim() ? JSON.parse(out) : undefined;
  } catch (cause) {
    console.error(
      `ERROR az ${azArgs.slice(0, 3).join(' ')}: ${String(cause.stderr ?? cause).trim()}`,
    );
    rmSync(work, { recursive: true, force: true });
    process.exit(1);
  }
}

try {
  const existing = az(['ad', 'app', 'list', '--display-name', NAME]);
  const app =
    existing?.[0] ??
    az(['rest', '--method', 'post', '--url', `${GRAPH}/applications`], {
      displayName: NAME,
      signInAudience: 'AzureADMyOrg',
    });
  const appId = app.appId;
  const objectId = app.id;
  const full = az(['rest', '--method', 'get', '--url', `${GRAPH}/applications/${objectId}`]);

  // Scope access_as_user (reutiliza el id si ya existe).
  const scope = (full.api?.oauth2PermissionScopes ?? []).find(
    (item) => item.value === 'access_as_user',
  );
  const scopeId = scope?.id ?? randomUUID();
  const scopeObject = {
    id: scopeId,
    value: 'access_as_user',
    type: 'User',
    isEnabled: true,
    adminConsentDisplayName: 'Acceder al asistente como el usuario',
    adminConsentDescription: 'Permite que Teams llame al asistente en nombre del usuario.',
    userConsentDisplayName: 'Acceder al asistente en tu nombre',
    userConsentDescription: 'Permite que Teams llame al asistente en tu nombre.',
  };
  const appIdUri = `api://${FQDN}/${appId}`;

  // Clientes de Teams y Microsoft 365 preautorizados: el SSO no pide consentimiento.
  const teamsClients = [
    '1fec8e78-bce4-4aaf-ab1b-5451cc387264', // Teams escritorio / móvil
    '5e3ce6c0-2b1f-4285-8d4b-75ee78787346', // Teams web
    '4765445b-32c6-49b0-83e6-1d93765276ca', // Microsoft 365 web
    '0ec893e0-5785-4de6-99da-4ed124e5296c', // Microsoft 365 escritorio
    'd3590ed6-52b3-4102-aeff-aad2292ab01c', // Microsoft 365 móvil / Outlook escritorio
    'bc59ab01-8403-45c6-8796-ac3ef710b3e3', // Outlook web
    '27922004-5251-4030-b22d-91ecd9a37ea4', // Outlook móvil
  ];

  // 1) El scope debe existir y estar habilitado antes de preautorizar clientes.
  az(['rest', '--method', 'patch', '--url', `${GRAPH}/applications/${objectId}`], {
    identifierUris: [appIdUri],
    api: { requestedAccessTokenVersion: 2, oauth2PermissionScopes: [scopeObject] },
  });

  // 2) Clientes preautorizados, permisos delegados de OpenID y redirect URIs.
  const graphApp = '00000003-0000-0000-c000-000000000000';
  const delegated = [
    '37f7f235-527c-4136-accd-4a02d197296e', // openid
    '14dad69e-099b-42c9-810b-d002981feec1', // profile
    '64a6cdd6-aab1-4aaf-94b8-3cc8405e90d0', // email
  ];
  az(['rest', '--method', 'patch', '--url', `${GRAPH}/applications/${objectId}`], {
    api: {
      requestedAccessTokenVersion: 2,
      oauth2PermissionScopes: [scopeObject],
      preAuthorizedApplications: teamsClients.map((client) => ({
        appId: client,
        delegatedPermissionIds: [scopeId],
      })),
    },
    requiredResourceAccess: [
      { resourceAppId: graphApp, resourceAccess: delegated.map((id) => ({ id, type: 'Scope' })) },
    ],
    web: {
      redirectUris: [
        `https://${FQDN}/api/auth/callback`,
        'http://localhost:3000/api/auth/callback',
      ],
    },
    optionalClaims: {
      accessToken: [
        { name: 'email', essential: false },
        { name: 'upn', essential: false },
      ],
      idToken: [{ name: 'email', essential: false }],
    },
  });

  // 3) Service principal (aplicación empresarial) en el tenant.
  const principals = az(['ad', 'sp', 'list', '--filter', `appId eq '${appId}'`]);
  if (!principals?.length) az(['ad', 'sp', 'create', '--id', appId]);

  const tenant = az(['account', 'show']).tenantId;
  const lines = [
    `ENTRA_TENANT_ID=${tenant}`,
    `ENTRA_CLIENT_ID=${appId}`,
    `ENTRA_APP_ID_URI=${appIdUri}`,
    `ASSISTANT_PUBLIC_FQDN=${FQDN}`,
  ];
  if (withSecret) {
    const secret = az([
      'ad',
      'app',
      'credential',
      'reset',
      '--id',
      appId,
      '--append',
      '--display-name',
      'teams-assistant-web',
      '--years',
      '1',
    ]);
    lines.push(`ENTRA_CLIENT_SECRET=${secret.password}`);
  }
  console.log(`\nRegistro "${NAME}" listo. Copia esto en .env:\n\n${lines.join('\n')}\n`);
  if (!withSecret) {
    console.log(
      'Falta ENTRA_CLIENT_SECRET para el login web: vuelve a ejecutar con --secret o créalo en el portal.',
    );
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
