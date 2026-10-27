// Scripts que se ejecutan como root vía pkexec. Viven aparte de install.ts para
// poder comprobar su sintaxis sin cargar Electron.

/**
 * Función bash compartida por los ayudantes de root: comprueba que el destino de
 * una copia cuelga de las copias del panel y que el camino resuelto no sale de
 * ahí. Sin esto, un enlace simbólico en el home del usuario podría hacer que
 * root escribiera o cediera la propiedad de archivos del sistema.
 */
export const SAFE_DEST_FN = String.raw`safe_dest() {
  local dest="$1" owner="$2" home backups parent real
  [ -n "$dest" ] || fail "falta el destino de la copia"
  [ -n "$owner" ] || fail "falta el propietario de la copia"
  home="$(readlink -f "$(getent passwd "$owner" | cut -d: -f6)" 2>/dev/null)"
  [ -n "$home" ] || fail "no se pudo resolver el home de $owner"
  backups="$home/.valet-dashboard/backups"
  parent="$(dirname "$dest")"
  mkdir -p "$parent"
  real="$(readlink -f "$parent")"
  case "$real" in
    "$backups"/?*) ;;
    *) fail "destino de copia fuera del panel: $dest" ;;
  esac
  # Las rutas ya están resueltas: ceder la propiedad aquí no puede tocar /etc.
  if [ -d "$backups" ]; then chown "$owner" "$backups"; fi
  chown "$owner" "$real"
  mkdir -m 0700 "$dest" || fail "el destino de copia ya existe: $dest"
  chown "$owner" "$dest"
}`

export const DNS_SCRIPT = String.raw`#!/bin/bash
set -Eeo pipefail
umask 022
MODE="$1"
TLD="$2"
BACKUP_DIR="$3"
HOSTS_FILE="$4"
OWNER="$5"
HOSTS_BEGIN="# BEGIN VALET DASHBOARD"
HOSTS_END="# END VALET DASHBOARD"

log() { printf '%s\n' "$*"; }
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "se requiere root"

${SAFE_DEST_FN}

INTERNET_BEFORE=0
getent hosts example.com >/dev/null 2>&1 && INTERNET_BEFORE=1 || true

backup() {
  [ -n "$BACKUP_DIR" ] || return 0
  safe_dest "$BACKUP_DIR" "$OWNER"
  for f in /etc/resolv.conf /etc/dnsmasq.conf /etc/dnsmasq.d /etc/default/dnsmasq /etc/NetworkManager/NetworkManager.conf /etc/NetworkManager/conf.d /etc/systemd/resolved.conf /etc/systemd/resolved.conf.d /etc/hosts /etc/valet-dashboard /etc/systemd/system/valet-dashboard-dns.service; do
    [ -e "$f" ] || continue
    cp -a "$f" "$BACKUP_DIR/$(basename "$f").$(date +%s%N)"
  done
  chown -R -h "$OWNER" "$BACKUP_DIR" 2>/dev/null || true
}

remove_hosts_block() {
  [ -f /etc/hosts ] || return 0
  local tmp
  tmp="$(mktemp)"
  awk -v b="$HOSTS_BEGIN" -v e="$HOSTS_END" '
    $0 == b { skip=1; next }
    $0 == e { skip=0; next }
    !skip { print }
  ' /etc/hosts > "$tmp"
  install -m 644 "$tmp" /etc/hosts
  rm -f "$tmp"
}

remove_safe() {
  systemctl disable --now valet-dashboard-dns.service >/dev/null 2>&1 || true
  rm -f /etc/systemd/system/valet-dashboard-dns.service
  rm -f /etc/systemd/resolved.conf.d/valet-dashboard.conf
  rm -rf /etc/valet-dashboard
  systemctl daemon-reload >/dev/null 2>&1 || true
  systemctl restart systemd-resolved >/dev/null 2>&1 || true
}

install_safe() {
  [ -n "$TLD" ] || fail "TLD vacío"
  [[ "$TLD" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] || fail "TLD no válido"
  systemctl is-active --quiet systemd-resolved || fail "systemd-resolved no está activo"
  [ -x /usr/sbin/dnsmasq ] || fail "dnsmasq no está instalado"

  remove_safe
  remove_hosts_block
  mkdir -p /etc/valet-dashboard /etc/systemd/resolved.conf.d

  cat > /etc/valet-dashboard/dnsmasq.conf <<EOF
port=5354
listen-address=127.0.0.1
bind-interfaces
no-resolv
no-hosts
local-ttl=0
log-facility=-
address=/$TLD/127.0.0.1
EOF

  cat > /etc/systemd/system/valet-dashboard-dns.service <<EOF
[Unit]
Description=Valet Dashboard DNS (.$TLD)
After=network.target

[Service]
ExecStart=/usr/sbin/dnsmasq --keep-in-foreground --conf-file=/etc/valet-dashboard/dnsmasq.conf
Restart=on-failure
User=root

[Install]
WantedBy=multi-user.target
EOF

  cat > /etc/systemd/resolved.conf.d/valet-dashboard.conf <<EOF
[Resolve]
DNS=127.0.0.1:5354
Domains=~$TLD
EOF

  /usr/sbin/dnsmasq --test --conf-file=/etc/valet-dashboard/dnsmasq.conf >/dev/null || { remove_safe; fail "dnsmasq rechazó la configuración"; }
  systemctl daemon-reload || { remove_safe; fail "No se pudo recargar systemd"; }
  systemctl enable --now valet-dashboard-dns.service || { remove_safe; fail "No se pudo iniciar el DNS seguro"; }
  systemctl restart systemd-resolved || { remove_safe; fail "No se pudo reiniciar systemd-resolved"; }
  sleep 1
  if ! getent hosts "valet-dashboard.$TLD" | grep -q '127.0.0.1'; then
    remove_safe
    fail "No se pudo resolver valet-dashboard.$TLD; se restauró la configuración"
  fi
  if [ "$INTERNET_BEFORE" -eq 1 ] && ! getent hosts example.com >/dev/null 2>&1; then
    remove_safe
    fail "El DNS general dejó de resolver; se restauró la configuración"
  fi
  log "DNS seguro activo: *.$TLD -> 127.0.0.1:5354"
}

install_hosts() {
  [ -f "$HOSTS_FILE" ] || fail "No existe el archivo de hosts"
  if grep -Evq '^(127\.0\.0\.1 [A-Za-z0-9.-]+|#|$)' "$HOSTS_FILE"; then
    fail "El archivo de hosts contiene líneas no válidas"
  fi
  remove_safe
  [ -f /etc/hosts ] || : > /etc/hosts
  local tmp
  tmp="$(mktemp)"
  awk -v b="$HOSTS_BEGIN" -v e="$HOSTS_END" '
    $0 == b { skip=1; next }
    $0 == e { skip=0; next }
    !skip { print }
  ' /etc/hosts > "$tmp"
  {
    printf '%s\n' "$HOSTS_BEGIN"
    cat "$HOSTS_FILE"
    printf '%s\n' "$HOSTS_END"
  } >> "$tmp"
  install -m 644 "$tmp" /etc/hosts
  rm -f "$tmp"
  log "Entradas de hosts actualizadas"
}

remove_all() {
  remove_safe
  remove_hosts_block
  log "DNS del dashboard eliminado"
}

backup

case "$MODE" in
  safe) install_safe ;;
  hosts) install_hosts ;;
  remove) remove_all ;;
  *) fail "Modo desconocido: $MODE" ;;
esac
`

export const BACKUP_SCRIPT = String.raw`#!/bin/bash
set -Eeo pipefail
umask 077
DEST="$1"
OWNER="$2"

fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

[ -n "$DEST" ] && [ -n "$OWNER" ] || exit 1
[ "$(id -u)" -eq 0 ] || fail "se requiere root"

${SAFE_DEST_FN}

safe_dest "$DEST" "$OWNER"
for f in /etc/nginx /etc/php /etc/apache2 /etc/dnsmasq.conf /etc/dnsmasq.d /etc/default/dnsmasq /etc/resolv.conf /etc/NetworkManager/NetworkManager.conf /etc/NetworkManager/conf.d /etc/systemd/resolved.conf /etc/systemd/resolved.conf.d /etc/hosts /etc/valet-dashboard /usr/local/bin/valet; do
  [ -e "$f" ] || continue
  cp -a "$f" "$DEST/"
done
chown -R -h "$OWNER" "$DEST" 2>/dev/null || true
`
