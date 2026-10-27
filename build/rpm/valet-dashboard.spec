# Especificación RPM de Valet Dashboard.
#
# electron-builder 25 empaqueta con fpm 1.9.3, que pasa un `--define buildroot`
# que rpm 6 ignora: el paquete falla con «File not found» en todos los ficheros.
# Esta especificación construye el mismo contenido con rpmbuild directamente.
#
# Se usa desde `npm run dist:rpm`, que define `_build_version` con la versión de
# package.json y deja el payload en `_sourcedir`.

%{!?_build_version:%global _build_version 0.1.0}

Name:           valet-dashboard
Version:        %{_build_version}
Release:        1
Summary:        Panel de escritorio para gestionar Valet Linux
License:        Proprietary
URL:            https://github.com/LC-jhony/valet-dashboard
Vendor:         LC-jhony <jhonyapm94@gmail.com>
Packager:       LC-jhony <jhonyapm94@gmail.com>
BuildArch:      x86_64
Requires:       gtk3
Requires:       libnotify
Requires:       nss
Requires:       libXScrnSaver
Requires:       xdg-utils
Requires:       at-spi2-core
Requires:       libuuid

%description
Panel de escritorio para gestionar Valet Linux: sitios, puertos, servicios,
DNS, certificados, entornos PHP y correo con Mailpit.

%install
mkdir -p %{buildroot}/opt/valet-dashboard
cp -a %{_sourcedir}/payload/. %{buildroot}/opt/valet-dashboard/
install -D -m 0644 %{_sourcedir}/valet-dashboard.desktop %{buildroot}/usr/share/applications/valet-dashboard.desktop
for size in 16 24 32 48 64 128 256 512 1024; do
  install -D -m 0644 %{_sourcedir}/icon-${size}.png %{buildroot}/usr/share/icons/hicolor/${size}x${size}/apps/valet-dashboard.png
done

%files
/opt/valet-dashboard
/usr/share/applications/valet-dashboard.desktop
/usr/share/icons/hicolor/16x16/apps/valet-dashboard.png
/usr/share/icons/hicolor/24x24/apps/valet-dashboard.png
/usr/share/icons/hicolor/32x32/apps/valet-dashboard.png
/usr/share/icons/hicolor/48x48/apps/valet-dashboard.png
/usr/share/icons/hicolor/64x64/apps/valet-dashboard.png
/usr/share/icons/hicolor/128x128/apps/valet-dashboard.png
/usr/share/icons/hicolor/256x256/apps/valet-dashboard.png
/usr/share/icons/hicolor/512x512/apps/valet-dashboard.png
/usr/share/icons/hicolor/1024x1024/apps/valet-dashboard.png

%post
if type update-alternatives 2>/dev/null >&1; then
    update-alternatives --install '/usr/bin/valet-dashboard' 'valet-dashboard' '/opt/valet-dashboard/valet-dashboard' 100 || ln -sf '/opt/valet-dashboard/valet-dashboard' '/usr/bin/valet-dashboard'
else
    ln -sf '/opt/valet-dashboard/valet-dashboard' '/usr/bin/valet-dashboard'
fi

if ! { [ -L /proc/self/ns/user ] && unshare --user true; }; then
    chmod 4755 '/opt/valet-dashboard/chrome-sandbox' || true
else
    chmod 0755 '/opt/valet-dashboard/chrome-sandbox' || true
fi

%postun
if [ "$1" = "0" ]; then
    if type update-alternatives 2>/dev/null >&1; then
        update-alternatives --remove 'valet-dashboard' '/opt/valet-dashboard/valet-dashboard' || true
    fi
    rm -f '/usr/bin/valet-dashboard'
fi

%changelog
* Tue Oct 27 2026 LC-jhony <jhonyapm94@gmail.com> - 0.1.0-1
- Primera versión publicada.
