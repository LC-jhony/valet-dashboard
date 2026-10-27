#!/usr/bin/env bash
# Construye el paquete RPM de Valet Dashboard.
#
# electron-builder 25 no puede generar RPM con rpm 6 (fpm 1.9.3 pasa un
# `--define buildroot` que rpm ignora). Este script reutiliza el payload que
# produce electron-builder y lo empaqueta con rpmbuild y build/rpm/*.spec.
#
# Uso: npm run dist:rpm
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VERSION="$(node -p "require('./package.json').version")"
TOPDIR="${RPM_TOPDIR:-${TMPDIR:-/tmp}/valet-dashboard-rpmbuild}"
DBPATH="${RPM_DBPATH:-$TOPDIR/rpmdb}"

if ! command -v rpmbuild >/dev/null 2>&1; then
  echo "Falta rpmbuild. En Debian/Ubuntu: sudo apt install rpm" >&2
  exit 1
fi
if ! command -v unshare >/dev/null 2>&1; then
  echo "Falta unshare (paquete util-linux)." >&2
  exit 1
fi

echo "==> Compilando la aplicación"
npm run build

echo "==> Empaquetando el payload"
npx electron-builder --linux dir

echo "==> Preparando rpmbuild $VERSION"
rm -rf "$TOPDIR"
mkdir -p "$TOPDIR"/{BUILD,RPMS,SOURCES,SPECS,SRPMS}
cp build/rpm/valet-dashboard.spec "$TOPDIR/SPECS/"

cp -a dist/linux-unpacked "$TOPDIR/SOURCES/payload"
for size in 16 24 32 48 64 128 256 512 1024; do
  cp "build/icons/${size}x${size}.png" "$TOPDIR/SOURCES/icon-${size}.png"
done
cp build/rpm/valet-dashboard.desktop "$TOPDIR/SOURCES/valet-dashboard.desktop"

# rpm 6 abre la base de datos del sistema aunque solo compile; se usa una
# propia para no necesitar root.
rpm --dbpath "$DBPATH" --initdb

echo "==> Construyendo el RPM"
rpmbuild -bb \
  --target x86_64-unknown-linux \
  --define "_topdir $TOPDIR" \
  --define "_dbpath $DBPATH" \
  --define "_tmppath ${TMPDIR:-/tmp}" \
  --define "_build_version $VERSION" \
  "$TOPDIR/SPECS/valet-dashboard.spec"

RPM="$(find "$TOPDIR/RPMS" -name '*.rpm' -print -quit)"
cp "$RPM" "$ROOT/dist/valet-dashboard-${VERSION}.x86_64.rpm"
echo "==> Listo: dist/valet-dashboard-${VERSION}.x86_64.rpm"
