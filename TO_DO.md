# TO DO — Publicar ARCH en npm

Preparación ya hecha en este repo (rename de scope a `@losina/*`, licencia MIT, `publishConfig`,
`files`, `.npmrc` con el registro público). Falta solo lo que requiere tu cuenta npm, que no se
puede hacer desde este PC:

1. **Login en npm** con la cuenta `losina`:

   ```bash
   npm login
   ```

2. **Verificar que apunta al registro público** (ya está fijado en [`.npmrc`](.npmrc), pero
   confírmalo si usas otra máquina/config):

   ```bash
   npm whoami
   # debe responder: losina
   ```

3. **Build limpio antes de publicar**:

   ```bash
   pnpm install
   pnpm build
   pnpm typecheck
   pnpm test
   pnpm lint
   ```

4. **Publicar todos los paquetes públicos en orden topológico** (pnpm lo resuelve solo y
   reescribe `workspace:*` a la versión real de cada dependencia):

   ```bash
   pnpm -r publish --no-git-checks
   ```

   - `@losina/e2e` es privado y se salta automáticamente.
   - Si algo falla a mitad, puedes publicar paquete a paquete con
     `pnpm --filter @losina/<paquete> publish --no-git-checks`, respetando el orden de
     dependencias (primero `schemas`, luego `config`/`ipc`/`claude-runtime`, luego `core`, después
     `architect`/`validator`, luego `tl`, después `daemon`, después `daemon-client`, y al final
     `cli`/`tui`).

5. **Comprobar la instalación real**:

   ```bash
   npm install -g @losina/arch-cli @losina/arch-terminal
   archctl --version
   arch-terminal
   ```

6. **Versionado en publicaciones futuras**: todos los paquetes están en `0.1.0`. Antes de volver a
   publicar, sube la versión del paquete cambiado (y de los que dependan de él) con
   `pnpm --filter @losina/<paquete> version <nueva-version>` o a mano en su `package.json`; npm
   rechaza publicar dos veces la misma versión.

## Opcional / pendiente de decidir

- Añadir un badge de versión npm al README una vez publicado el primer release.
- Homebrew tap (`Losina24/homebrew-arch`) y/o Scoop, si en el futuro se quiere distribuir también
  fuera de npm (ver conversación previa: viable pero requiere mantener una fórmula que envuelve el
  install script).
