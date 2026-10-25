// Package php manages local PHP-FPM images and containers.
package php

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"text/template"
	"time"

	assets "devenv/embed"
	"devenv/internal/config"
	"devenv/internal/podman"
	"devenv/internal/project"
	"devenv/internal/quadlet"
	"devenv/internal/state"
	"devenv/internal/systemd"
	"devenv/internal/ui"
)

type Manager struct {
	Paths   config.Paths
	Podman  *podman.Client
	Systemd *systemd.Manager
	Quadlet *quadlet.Manager
	UI      *ui.UI
}

func ImageName(version string) string {
	return "localhost/devenv-php" + NoDot(version) + ":latest"
}

func BaseImage(version string) string {
	return "docker.io/library/php:" + version + "-fpm-alpine"
}

func ContainerName(version string) string {
	return "devenv-php" + NoDot(version) + "-fpm"
}

func UnitName(version string) string {
	return "devenv-php" + NoDot(version) + ".service"
}

func NoDot(version string) string {
	return strings.ReplaceAll(version, ".", "")
}

type buildData struct {
	Version     string
	UID         int
	GID         int
	Packages    string
	ExtInstall  string
	PeclInstall string
	PeclList    []string
}

// EnsureImage pulls the base image (with confirmation) and builds the local
// PHP image when it does not exist.
func (m *Manager) EnsureImage(ctx context.Context, version string, cfg config.Config, force bool) error {
	if !force && m.Podman.ImageExists(ctx, ImageName(version)) {
		return nil
	}
	if err := m.Podman.Pull(ctx, BaseImage(version), false); err != nil {
		return err
	}
	ok, err := m.UI.Confirm(fmt.Sprintf("Construir imagen PHP %s con extensiones %s (los paquetes adicionales pueden aumentar el tamaño)", version, strings.Join(cfg.PHP.Extensions, ", ")))
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("construcción de PHP %s cancelada", version)
	}

	dir := filepath.Join(m.Paths.BuildDir, "php", version)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	packages := append([]string(nil), cfg.PHP.Packages...)
	if len(packages) == 0 {
		packages = []string{"git", "unzip"}
	}
	extInstall, peclInstall := splitExtensions(cfg.PHP.Extensions)
	if err := m.writeBuildContext(dir, version, packages, extInstall, peclInstall); err != nil {
		return err
	}
	if err := m.Podman.Build(ctx, ImageName(version), filepath.Join(dir, "Dockerfile"), dir, map[string]string{
		"HOST_UID": fmt.Sprint(os.Getuid()),
		"HOST_GID": fmt.Sprint(os.Getgid()),
	}); err != nil {
		return err
	}
	m.UI.Success("Imagen PHP %s construida", version)
	return nil
}

func (m *Manager) writeBuildContext(dir, version string, packages, extInstall, pecl []string) error {
	data := buildData{
		Version:     version,
		UID:         os.Getuid(),
		GID:         os.Getgid(),
		Packages:    strings.Join(packages, " "),
		ExtInstall:  strings.Join(extInstall, " "),
		PeclInstall: strings.Join(pecl, " "),
		PeclList:    pecl,
	}
	raw, err := assets.FS.ReadFile("php/Dockerfile.tmpl")
	if err != nil {
		return err
	}
	t, err := template.New("Dockerfile").Option("missingkey=error").Parse(string(raw))
	if err != nil {
		return err
	}
	var buf strings.Builder
	if err := t.Execute(&buf, data); err != nil {
		return err
	}
	if err := state.WriteFile(filepath.Join(dir, "Dockerfile"), []byte(buf.String()), 0o644); err != nil {
		return err
	}
	for src, dst := range map[string]string{"php/www.conf": "www.conf", "php/php.ini": "php.ini"} {
		content, err := assets.FS.ReadFile(src)
		if err != nil {
			return err
		}
		if err := state.WriteFile(filepath.Join(dir, dst), content, 0o644); err != nil {
			return err
		}
	}
	return nil
}

func splitExtensions(exts []string) (install, pecl []string) {
	builtin := map[string]bool{
		"pdo": true, "pdo_mysql": true, "mysqli": true, "mbstring": true,
		"intl": true, "zip": true, "opcache": true, "bcmath": true,
		"pcntl": true, "gd": true, "exif": true, "sockets": true,
		"soap": true, "xsl": true, "calendar": true, "ctype": true,
		"curl": true, "dom": true, "fileinfo": true, "filter": true,
		"ftp": true, "iconv": true, "json": true, "libxml": true,
		"openssl": true, "pdo_sqlite": true, "phar": true, "posix": true,
		"readline": true, "session": true, "simplexml": true, "sqlite3": true,
		"tokenizer": true, "xml": true, "xmlreader": true, "xmlwriter": true,
		"zlib": true,
	}
	for _, ext := range exts {
		ext = strings.TrimSpace(ext)
		if ext == "" {
			continue
		}
		if builtin[ext] {
			install = append(install, ext)
		} else {
			pecl = append(pecl, ext)
		}
	}
	sort.Strings(install)
	sort.Strings(pecl)
	return install, pecl
}

// SyncUnit regenerates the FPM Quadlet for a version with the sites that use it.
func (m *Manager) SyncUnit(ctx context.Context, version string, sites []config.Site) (string, error) {
	var mounts []quadlet.SiteMount
	for _, site := range sites {
		if site.PHP != version {
			continue
		}
		mounts = append(mounts, quadlet.SiteMount{
			HostPath:      site.Path,
			ContainerPath: project.ContainerRoot(site.Name),
		})
	}
	unit, err := m.Quadlet.InstallPHP(quadlet.PHPData{
		Version: version,
		NoDot:   NoDot(version),
		Image:   ImageName(version),
		BinDir:  m.Paths.BinDir,
		Sites:   mounts,
	})
	if err != nil {
		return "", err
	}
	if err := m.Quadlet.Reload(ctx); err != nil {
		return "", err
	}
	return unit, nil
}

// Start ensures the unit is running and waits for the container.
func (m *Manager) Start(ctx context.Context, version string) error {
	unit := UnitName(version)
	if err := m.Systemd.Start(ctx, unit); err != nil {
		return err
	}
	deadline := time.Now().Add(45 * time.Second)
	for time.Now().Before(deadline) {
		if m.Podman.ContainerRunning(ctx, ContainerName(version)) {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(500 * time.Millisecond):
		}
	}
	return fmt.Errorf("PHP %s no arrancó; revisa `devenv logs php%s`", version, NoDot(version))
}

// Exec runs a PHP command in the project's FPM container.
func (m *Manager) Exec(ctx context.Context, version string, site config.Site, interactive bool, args ...string) (string, error) {
	if !m.Podman.ContainerRunning(ctx, ContainerName(version)) {
		if err := m.Start(ctx, version); err != nil {
			return "", err
		}
	}
	callArgs := append([]string{"php"}, args...)
	return m.Podman.ExecWith(ctx, ContainerName(version), podman.ExecOptions{
		Interactive: interactive,
		Workdir:     project.ContainerWorkdir(site),
	}, callArgs...)
}

// ListInstalled returns local PHP image versions and running containers.
func (m *Manager) ListInstalled(ctx context.Context) ([]string, error) {
	out, err := m.Podman.Runner.Run(ctx, "podman", "images", "--format", "{{.Repository}}:{{.Tag}}")
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	var versions []string
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "localhost/devenv-php") {
			continue
		}
		base := strings.TrimPrefix(line, "localhost/devenv-php")
		base = strings.TrimSuffix(base, ":latest")
		if len(base) == 2 {
			v := base[:1] + "." + base[1:]
			if !seen[v] {
				seen[v] = true
				versions = append(versions, v)
			}
		}
	}
	sort.Strings(versions)
	return versions, nil
}
