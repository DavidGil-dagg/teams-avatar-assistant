/**
 * Prueba Microsoft-Decision con frases sueltas: `pnpm decide "texto del asistente"`.
 * Sin argumentos usa una batería de ejemplos. Sirve para afinar las etiquetas de
 * `lib/assistant/expressions.ts` y las preguntas de `lib/assistant/decision.ts`.
 * Formato opcional `usuario => respuesta` para incluir lo que dijo el usuario.
 */
import { decide } from '@/lib/assistant/decision';

const SAMPLES = [
  'Hola. ¿En qué puedo ayudarte hoy?',
  '¡Me aprobaron el proyecto! => ¡Qué buena noticia, felicidades! Te lo ganaste a pulso.',
  'Me despidieron hoy => Lo siento mucho. Es un golpe duro; tómate un momento y lo pensamos juntos.',
  '¿Cuánto es 15 por 12? => Ciento ochenta.',
  'Cuéntame un chiste => ¿Qué le dice un semáforo a otro? No me mires, que me estoy cambiando.',
  'Voy a mentirle a mi cliente => No. Eso sería un error y no voy a ayudarte con eso.',
  '¡Terminé el proyecto en dos días! => ¿En dos días? Eso sí que no me lo esperaba, impresionante.',
  '¿Qué estrategia me recomiendas? => Déjame pensarlo. Hay dos caminos posibles y cada uno tiene su riesgo.',
  'Gracias por todo => Ha sido un placer. Vuelve cuando quieras.',
  'Explícame qué es una API => Una API es un contrato: define cómo un programa le pide algo a otro.',
];

async function main() {
  const inputs = process.argv.slice(2);
  for (const line of inputs.length ? inputs : SAMPLES) {
    const [first, second] = line.split('=>').map((part) => part.trim());
    const input = second ? { userText: first, replyText: second } : { replyText: first };
    const result = await decide(input, { timeoutMs: 15_000 });
    const percent = (value?: number) => (value === undefined ? '' : ` ${Math.round(value * 100)}%`);
    console.log(
      `${result.emotion}${percent(result.emotionConfidence)} · ${result.gesture}${percent(result.gestureConfidence)} · ${result.latencyMs} ms${result.fallback ? ' (fallback)' : ''}\n    ${line}`,
    );
  }
}

void main();
