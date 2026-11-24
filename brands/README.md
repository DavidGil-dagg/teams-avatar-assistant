# Marcas

Cada carpeta de aquí es una marca completa: cómo se llama el asistente, cómo se ve y cómo es su avatar.

- `default/` es la marca blanca. Es la única que se versiona.
- Cualquier otra carpeta la ignora git (ver `.gitignore`). Ahí va la marca de tu organización: su nombre, su logo, sus colores y su avatar se quedan en tu máquina.

## Crear una marca

1. Copia la carpeta de marca blanca con otro nombre, en minúsculas y sin espacios:

   ```powershell
   Copy-Item brands\default brands\mi-marca -Recurse
   ```

2. Edita `brands/mi-marca/brand.json`: nombre del asistente, textos, colores, tipografía, personalidad y datos de Teams. Si tienes logo, déjalo en `brands/mi-marca/public/` y decláralo en `logo`.
3. Edita `brands/mi-marca/avatar.json`: en `basePrompt` describe a tu personaje.
4. Genera su avatar:

   ```powershell
   pnpm avatar:generate base --brand=mi-marca --force
   ```

   Revisa `brands/mi-marca/work/base-preview.png`, mide dónde queda la cara y ajusta `face` en `avatar.json`. Después:

   ```powershell
   pnpm avatar:generate frames --brand=mi-marca --force
   ```

5. Actívala en `.env` con `ASSISTANT_BRAND=mi-marca`.

El código valida `brand.json` al cargarlo y dice qué campo falla. Los colores deben tener la forma `#RRGGBB`.

## Antes de subir cambios

Comprueba que tu marca no se ha colado en el commit:

```powershell
git status --short brands
```

Solo deben aparecer archivos de `brands/default/` (y este `README.md`). El test `tests/brand.test.ts` falla si git rastrea cualquier otra carpeta de marca.

No copies datos de una marca privada fuera de su carpeta: ni en el código, ni en los tests, ni en la documentación, ni en `.env.example`.
