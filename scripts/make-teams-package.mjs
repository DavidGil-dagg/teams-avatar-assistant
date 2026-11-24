/**
 * Arma el paquete de Teams de la marca activa: `pnpm teams:package`.
 *
 * Rellena `teams-app/manifest.json` con los textos de `brands/<id>/brand.json`
 * (sección `teams`) y con las variables de `.env` (ASSISTANT_PUBLIC_FQDN,
 * ENTRA_CLIENT_ID, ENTRA_APP_ID_URI), genera los iconos con los colores de la
 * marca y deja `teams-app/build/` listo, más `teams-app/<marca>.zip` si el
 * sistema tiene `tar` (Windows 10+, macOS y Linux lo traen).
 *
 * El id de la app de Teams se guarda en `teams-app/app-id.txt` (fuera de git)
 * para que las actualizaciones del paquete sigan siendo la misma app.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import sharp from 'sharp';

const root = process.cwd();
const teamsDir = path.join(root, 'teams-app');
const buildDir = path.join(teamsDir, 'build');

function need(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Falta ${name} en .env`);
    process.exit(1);
  }
  return value;
}

const brandId = process.env.ASSISTANT_BRAND?.trim() || 'default';
if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(brandId)) {
  console.error(`ASSISTANT_BRAND no es un nombre de marca válido: ${brandId}`);
  process.exit(1);
}
const brandDir = path.join(root, 'brands', brandId);
const brandFile = path.join(brandDir, 'brand.json');
if (!existsSync(brandFile)) {
  console.error(`No existe la marca "${brandId}" (falta ${path.relative(root, brandFile)})`);
  process.exit(1);
}
const brand = JSON.parse(readFileSync(brandFile, 'utf8'));
const teams = brand.teams ?? {};
const colors = brand.colors ?? {};
for (const [name, value] of Object.entries({ ...colors, accentColor: teams.accentColor })) {
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) {
    console.error(`brand.json: el color "${name}" debe tener la forma #RRGGBB`);
    process.exit(1);
  }
}

const fqdn = need('ASSISTANT_PUBLIC_FQDN')
  .replace(/^https?:\/\//, '')
  .replace(/\/+$/, '');
const clientId = need('ENTRA_CLIENT_ID');
const appIdUri = process.env.ENTRA_APP_ID_URI?.trim() || `api://${fqdn}/${clientId}`;

const idFile = path.join(teamsDir, 'app-id.txt');
const appId = existsSync(idFile) ? readFileSync(idFile, 'utf8').trim() : randomUUID();
if (!existsSync(idFile)) writeFileSync(idFile, `${appId}\n`);

// Los textos van dentro de cadenas JSON: se escapan como tales.
const json = (value) => JSON.stringify(String(value ?? '')).slice(1, -1);
const values = {
  TEAMS_APP_ID: appId,
  FQDN: fqdn,
  ENTRA_CLIENT_ID: clientId,
  ENTRA_APP_ID_URI: appIdUri,
  DEVELOPER: json(teams.developer),
  SHORT_NAME: json(teams.shortName),
  FULL_NAME: json(teams.fullName),
  SHORT_DESCRIPTION: json(teams.shortDescription),
  FULL_DESCRIPTION: json(teams.fullDescription),
  ACCENT_COLOR: teams.accentColor,
};
let manifest = readFileSync(path.join(teamsDir, 'manifest.json'), 'utf8');
for (const [key, value] of Object.entries(values)) {
  manifest = manifest.replaceAll(`{{${key}}}`, value);
}
JSON.parse(manifest);
if (manifest.includes('{{')) {
  console.error('Quedan marcadores sin rellenar en el manifest');
  process.exit(1);
}

rmSync(buildDir, { recursive: true, force: true });
mkdirSync(buildDir, { recursive: true });
writeFileSync(path.join(buildDir, 'manifest.json'), manifest);

// Silueta genérica de asistente de voz: un globo de diálogo con una onda de sonido.
const glyph = (fill, cut) =>
  `<path fill="${fill}" d="M20 18h56a10 10 0 0 1 10 10v32a10 10 0 0 1-10 10H50L32 84V70H20a10 10 0 0 1-10-10V28a10 10 0 0 1 10-10z"/>` +
  [
    [30, 12],
    [42, 24],
    [54, 12],
    [66, 20],
  ]
    .map(
      ([x, height]) =>
        `<rect fill="${cut}" x="${x - 3}" y="${44 - height / 2}" width="6" height="${height}" rx="3"/>`,
    )
    .join('');

const background = `<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192" viewBox="0 0 96 96">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${colors.deep}"/><stop offset="1" stop-color="${colors.base}"/>
  </linearGradient></defs>
  <rect width="96" height="96" fill="url(#g)"/>`;
const colorSvg = `${background}
  <g transform="translate(9.6 9.6) scale(0.8)">${glyph(colors.accent, colors.deep)}</g>
</svg>`;
// El icono de contorno de Teams debe ser blanco sobre transparente.
const outlineSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 96 96"><defs><mask id="m"><rect width="96" height="96" fill="black"/>${glyph('white', 'black')}</mask></defs><rect width="96" height="96" fill="#FFFFFF" mask="url(#m)"/></svg>`;

// Con el avatar generado, el icono de color muestra el rostro del asistente.
const portrait = path.join(brandDir, 'public', 'avatar', 'body-base.webp');
if (existsSync(portrait)) {
  const { width = 768 } = await sharp(portrait).metadata();
  const side = Math.round(width * 0.62);
  const head = await sharp(portrait)
    .extract({ left: Math.round((width - side) / 2), top: 0, width: side, height: side })
    .resize(176, 176)
    .toBuffer();
  await sharp(Buffer.from(`${background}</svg>`))
    .composite([{ input: head, left: 8, top: 16 }])
    .png()
    .toFile(path.join(buildDir, 'color.png'));
} else {
  await sharp(Buffer.from(colorSvg)).png().toFile(path.join(buildDir, 'color.png'));
}
await sharp(Buffer.from(outlineSvg)).png().toFile(path.join(buildDir, 'outline.png'));

const zipPath = path.join(teamsDir, `${brandId}.zip`);
rmSync(zipPath, { force: true });
try {
  execFileSync('tar', ['-a', '-c', '-f', zipPath, 'manifest.json', 'color.png', 'outline.png'], {
    cwd: buildDir,
    stdio: 'ignore',
  });
  console.log(`Paquete de Teams: ${path.relative(root, zipPath)}`);
} catch {
  console.log(
    `No se pudo crear el zip automáticamente: comprime los tres archivos de ${path.relative(root, buildDir)}.`,
  );
}
console.log(`Marca: ${brandId}\nHost: ${fqdn}\nApp de Teams: ${appId}\nRecurso SSO: ${appIdUri}`);
