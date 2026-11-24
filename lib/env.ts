/** Lectura de variables de entorno (solo servidor y scripts). */

export function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function required(name: string): string {
  const value = env(name);
  if (!value) throw new Error(`Falta la variable de entorno ${name}`);
  return value;
}
