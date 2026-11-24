/**
 * Prueba de humo contra Foundry: `pnpm smoke:foundry`.
 *
 * Comprueba la autenticación, crea un token efímero de la Realtime API y hace
 * una pregunta a Microsoft-Decision. Imprime la forma de las respuestas (nunca
 * el valor de un secreto) para confirmar el contrato antes de construir encima.
 */
import { env } from '@/lib/env';
import { foundryAuthHeaders } from '@/lib/foundry/auth';
import { foundryEndpoints } from '@/lib/foundry/endpoints';

const TIMEOUT_MS = 30_000;
let failed = false;

function report(name: string, ok: boolean, detail: string) {
  if (!ok) failed = true;
  console.log(`${ok ? 'OK   ' : 'FALLO'} ${name}: ${detail}`);
}

async function main() {
  const endpoints = foundryEndpoints();
  if (!endpoints) {
    report('config', false, 'FOUNDRY_ENDPOINT falta o no es https');
    return;
  }
  let auth: Record<string, string> | undefined;
  try {
    auth = await foundryAuthHeaders();
  } catch (cause) {
    report('auth', false, (cause as Error).message.split('\n')[0] ?? 'error');
    return;
  }
  if (!auth) {
    report('auth', false, 'FOUNDRY_API_KEY sin valor');
    return;
  }
  report('auth', true, auth.Authorization ? 'token de Entra ID' : 'api-key');

  // 1) Microsoft-Decision
  const decisionModel = env('MODEL_DECISION') ?? 'Decision-1';
  const started = Date.now();
  const decision = await fetch(endpoints.decision, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: decisionModel,
      state:
        'User: ¡Me aprobaron el proyecto!\nAda (character): ¡Excelente! Me alegra mucho, te lo ganaste.',
      questions: {
        emotion: {
          type: 'choice',
          instructions: 'Which emotion does the character show in their reply to the user?',
          criteria: {
            neutral: 'neutral, calm',
            happy: 'happy, joyful',
            sad: 'sad, sorry, disappointed',
            angry: 'angry, annoyed',
          },
        },
        congratulates: {
          type: 'noul',
          instructions: 'Does the character congratulate the user?',
        },
      },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const decisionText = await decision.text();
  report(
    `decision (${decisionModel})`,
    decision.ok,
    `HTTP ${decision.status} en ${Date.now() - started} ms → ${decisionText.slice(0, 900)}`,
  );

  // 2) Realtime: token efímero
  const realtimeModel = env('MODEL_REALTIME') ?? 'gpt-realtime-2.1';
  const secret = await fetch(endpoints.realtimeClientSecrets, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session: {
        type: 'realtime',
        model: realtimeModel,
        instructions: 'Prueba de humo.',
        output_modalities: ['audio'],
        audio: { input: { turn_detection: { type: 'semantic_vad' } }, output: { voice: 'marin' } },
      },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (secret.ok) {
    const body = (await secret.json()) as Record<string, unknown>;
    const value = body.value ?? (body.client_secret as { value?: unknown } | undefined)?.value;
    report(
      `realtime (${realtimeModel})`,
      typeof value === 'string' && value.length > 0,
      `HTTP ${secret.status}, campos: ${Object.keys(body).join(', ')}`,
    );
  } else {
    report(
      `realtime (${realtimeModel})`,
      false,
      `HTTP ${secret.status} → ${(await secret.text()).slice(0, 500)}`,
    );
  }
}

main()
  .catch((cause) => report('smoke', false, String(cause)))
  .finally(() => {
    process.exitCode = failed ? 1 : 0;
  });
