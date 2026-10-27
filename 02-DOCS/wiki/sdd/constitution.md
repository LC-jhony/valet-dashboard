---
type: constitution
title: valet-dashboard — Constitution
description: Los principios no negociables que obedece cada fase de rsc-sdd.
tags: [sdd, constitution]
timestamp: 2026-10-26T22:10:00Z
topic: sdd
version: v1.0.0
---

# valet-dashboard — Constitution

> Versión: v1.0.0 · Ratificada: 2026-10-26 · Última enmienda: 2026-10-26
> Los principios no negociables que obedece cada fase de rsc-sdd.
> El detalle de mecánica vive en `wiki/`; aquí solo se fija la regla y se enlaza el detalle.

## 1. Stack canon

1. El panel es Electron 33 + React 19 + TypeScript 5.9 con `strict: true`, fijado en `package.json`
   y `tsconfig.json`. El renderer corre con `contextIsolation` y sin `nodeIntegration`; nadie lo
   rebaja a `false`.
2. El CLI es Go 1.27.3, fijado en `devenv/go.mod`. Se compila con el toolchain de esa versión y no
   se añaden módulos fuera de `go.mod` sin justificarlo en la decisión.
3. No se añaden dependencias npm nuevas sin necesidad demostrada y aprobación explícita del dueño;
   un solo `package-lock.json` commiteado.
4. Estado de la máquina (config, datos, binarios descargados) vive en `~/.valet-dashboard/` y
   `~/.config/valet-dashboard/`. El repo nunca guarda estado de un equipo concreto.

## 2. Barra de calidad

5. `npm run typecheck` pasa limpio antes de cada commit (es `tsc --noEmit` con `strict`).
6. `npm run build` compila main, preload y renderer sin errores antes de cada commit.
7. En `devenv`: `gofmt -l .` no devuelve nada, y `go vet ./...` y `go test ./...` están en verde.
8. Todo cambio que escribe ficheros del usuario (config, `.env`, unidades systemd, certificados) se
   prueba contra una copia temporal y con reversión; nunca contra los datos reales del usuario.

## 3. Convenciones

9. La interfaz, la documentación y los commits van en español; los identificadores de código, en
   inglés.
10. Commits en Conventional Commits en español y sin scope salvo que aclare:
    `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`. Sin emojis.
11. El contrato IPC vive en `src/shared/`. El renderer no ejecuta comandos del sistema ni toca el
    filesystem: todo pasa por el `preload` y por handlers validados en `main`.
12. Cada servicio externo se gestiona como unidad systemd de usuario (`systemctl --user`) y la UI
    nunca se bloquea: las operaciones lentas van al proceso principal, con timeout y estado
    observable.

## 4. Ramas y entrega

13. Los cambios van directos a `main` (elegido en el install: no hay PR ni CI). Antes del commit:
    barra de calidad completa y `git diff --check` limpio.
14. **La autoría de Git es humana.** Sin `Co-Authored-By` de una IA y sin pie "generated with".
    Se aplica en la fase `ship`.

## 5. Suelo de seguridad y privacidad

15. Ningún secreto se commitea. Contraseñas, certificados y `.env` viven fuera del repo y con
    permisos `0600`.
16. Todo comando con privilegios pasa por la ruta de elevación existente y se muestra al usuario
    qué se va a ejecutar; nunca se concatena entrada no validada en una shell.
17. Un binario externo (Mailpit u otro) se descarga solo desde su fuente oficial y se verifica por
    SHA-256 antes de ejecutarse.

## 6. Suelo de UX y accesibilidad

18. Todo lo accionable se alcanza con teclado, tiene atajo y foco visible, y mantiene contraste AA
    en tema claro y oscuro.
19. Ninguna acción destructiva (borrar sitio, desinstalar, sobrescribir un `.env`) se ejecuta sin
    una confirmación que diga qué se pierde.

## 7. Conocimiento y decisiones

20. `wiki/` es la documentación humana del proyecto. `02-DOCS/wiki/` guarda el harness y el SDD. Las
    páginas clave de `wiki/` se ingieren en `02-DOCS/raw/` con `rsc ingest` cuando cambian, en vez
    de duplicarlas a mano.
21. Toda decisión significativa se anexa con fecha, opciones y motivo en
    `02-DOCS/wiki/harness/decisions.md`. Esta constitución es el registro de mayor orden.

## Definition of Done (la barra que ejecuta `verify`)

Un cambio solo entra cuando se cumple **todo**:

- [ ] `npm run typecheck` y `npm run build` limpios (principios 5-6).
- [ ] `gofmt -l .`, `go vet ./...` y `go test ./...` limpios si se tocó `devenv` (principio 7).
- [ ] Los ficheros del usuario se probaron contra copia temporal, con reversión (principio 8).
- [ ] Convenciones respetadas: idioma, commits, contrato IPC, systemd de usuario (9-12).
- [ ] Directo a `main`, autoría humana, sin emojis ni pies de IA (13-14).
- [ ] Ningún secreto commiteado; elevación visible; binarios verificados por SHA-256 (15-17).
- [ ] Teclado, foco y contraste AA; acción destructiva confirmada (18-19).
- [ ] Documentación tocada; decisión anexada si la hubo (20-21).

## Registro de enmiendas (solo se añade)

| Fecha | Versión | Cambio | Motivo |
|-------|---------|--------|--------|
| 2026-10-26 | draft | Borrador generado por `rsc onboard`. | El SDD necesita una constitución; ratificarla es trabajo de la fase `constitution`. |
| 2026-10-26 | v1.0.0 | Borrador completo (21 principios y Definition of Done) y **ratificado** por el dueño. | Entrevista con el dueño: barra de calidad typecheck+build+Go, UX teclado+contraste AA, wiki humana con ingesta. |
