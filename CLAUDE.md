# Teams Assistant

Asistente de voz con avatar 2D para Microsoft Teams sobre Microsoft Foundry. El `README.md` explica la arquitectura y los comandos.

## Reglas

- Todo el texto del proyecto (interfaz, comentarios, documentación, mensajes de error) va en español.
- **El código no menciona ninguna marca.** Nombre del asistente, textos, colores, tipografía, logo, personalidad y avatar viven en `brands/<id>/`. Solo `brands/default/` (marca blanca) se versiona; las demás carpetas de `brands/` las ignora git.
- **Nada de una marca privada sale de su carpeta.** No copies sus nombres, colores, logos, imágenes, endpoints, tenants ni dominios a código, tests, documentación, ejemplos de configuración o mensajes de commit. Antes de un commit, revisa `git status` y `git diff --cached`: no debe aparecer nada bajo `brands/` que no sea `brands/default/`.
- El modelo de conversación nunca decide la cara. Emociones y gestos son tablas cerradas en `lib/assistant/expressions.ts` y los elige `Decision-1` (`lib/assistant/decision.ts`).
- El avatar son tres capas independientes (cuerpo, ojos, boca). No vuelvas a un sprite único por estado: la boca dejaría de moverse cuando cambia la emoción o hay un gesto.
- El token efímero de la Realtime API y los endpoints de Foundry nunca salen del servidor.
- `lib/auth/entra.ts` es el único archivo que lee la cabecera `Authorization` entrante.
- La entrada de pruebas no existe en producción (`isTestLoginEnabled` en `lib/auth/config.ts`). No la amplíes sin pedirlo.

## Antes de entregar

```
pnpm test
pnpm typecheck
pnpm lint
```

## Cosas que no son obvias

- La marca activa se elige con `ASSISTANT_BRAND` y se lee del disco en cada petición (`lib/brand.ts`): cambiarla no requiere recompilar. Sus archivos públicos los sirve `/brand-assets/…`, no `public/`.
- Foundry se llama con `fetch`, sin SDK. Los contratos se verifican con `pnpm smoke:foundry`.
- `Decision-1` responde `answers.<pregunta>.{choice, confidence, probabilities}`.
- La llamada admite `recvonly` (sin micrófono): sirve para probar en un navegador sin acceso al micrófono.
- `scripts/generate-avatar.ts` llama al modelo de imagen y cuesta dinero: no lo ejecutes con `--force` sin que te lo pidan.
- `scripts/register-entra.mjs` cambia el tenant de Entra: lo ejecuta el dueño del tenant, no el agente.
