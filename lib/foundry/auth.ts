/**
 * Microsoft Foundry sin claves: cuando `FOUNDRY_API_KEY=entra`, las llamadas a
 * los modelos van con un token de Microsoft Entra ID (identidad administrada en
 * Azure, `az login` en local). Con cualquier otro valor se usa la cabecera
 * `api-key`.
 */
import { env } from '@/lib/env';

export const ENTRA_API_KEY_SENTINEL = 'entra';
const SCOPE = 'https://cognitiveservices.azure.com/.default';

export function usesEntraAuth(apiKey: string | undefined): boolean {
  return apiKey?.trim().toLowerCase() === ENTRA_API_KEY_SENTINEL;
}

type TokenCredentialLike = {
  getToken(scope: string): Promise<{ token: string; expiresOnTimestamp: number } | null>;
};

let credential: TokenCredentialLike | undefined;
let cached: { token: string; expiresAt: number } | undefined;

/** Token de Entra ID para Foundry, en caché hasta 5 min antes de vencer. */
export async function foundryBearerToken(): Promise<string> {
  if (cached && cached.expiresAt - Date.now() > 5 * 60_000) return cached.token;
  if (!credential) {
    const { DefaultAzureCredential } = await import('@azure/identity');
    const managedIdentityClientId = env('AZURE_CLIENT_ID');
    credential = new DefaultAzureCredential(
      managedIdentityClientId ? { managedIdentityClientId } : undefined,
    );
  }
  const token = await credential.getToken(SCOPE);
  if (!token) throw new Error('Foundry: no se obtuvo token de Entra ID');
  cached = { token: token.token, expiresAt: token.expiresOnTimestamp };
  return token.token;
}

/** Cabeceras de autenticación para Foundry, o `undefined` si no hay nada configurado. */
export async function foundryAuthHeaders(): Promise<Record<string, string> | undefined> {
  const apiKey = env('FOUNDRY_API_KEY');
  if (usesEntraAuth(apiKey)) return { Authorization: `Bearer ${await foundryBearerToken()}` };
  return apiKey ? { 'api-key': apiKey } : undefined;
}
