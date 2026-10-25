package app

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"devenv/internal/config"
	"devenv/internal/php"
	"devenv/internal/project"
	"devenv/internal/quadlet"
	"devenv/internal/service"
	"devenv/internal/watcher"
)

func (a *App) Status(ctx context.Context) error {
	a.UI.Heading("devenv status")
	if err := a.Podman.Available(ctx); err != nil {
		a.UI.Error("%v", err)
		return nil
	}
	a.UI.Success("podman rootless operativo")

	if _, err := a.Runner.Run(ctx, "podman", "network", "inspect", "devenv"); err == nil {
		a.UI.Success("red podman devenv")
	} else {
		a.UI.Error("red podman devenv ausente (devenv install)")
	}

	if a.Podman.ContainerRunning(ctx, "devenv-nginx") {
		if out, err := a.Nginx.Test(ctx); err != nil {
			a.UI.Error("nginx corre pero la configuración falla: %s", strings.TrimSpace(out))
		} else {
			a.UI.Success("nginx corriendo y configuración válida")
		}
	} else {
		a.UI.Error("nginx no está corriendo")
	}

	sites, _ := config.LoadSites(a.Paths)
	versions := map[string]bool{}
	for _, s := range sites.Sites {
		versions[s.PHP] = true
	}
	var phpRows [][]string
	for v := range versions {
		status := "detenido"
		if a.Podman.ContainerRunning(ctx, php.ContainerName(v)) {
			status = "corriendo"
		}
		phpRows = append(phpRows, []string{v, php.ContainerName(v), status})
	}
	if len(phpRows) > 0 {
		a.UI.Heading("PHP-FPM")
		a.UI.Table([]string{"versión", "contenedor", "estado"}, phpRows)
	}

	svcRows, err := a.Services.List(ctx)
	if err == nil && len(svcRows) > 0 {
		a.UI.Heading("Servicios")
		a.UI.Table([]string{"servicio", "versión", "puerto", "activo", "salud"}, svcRows)
	}

	if a.Config.TLD != "localhost" {
		ok, msg := a.DNS.Check(ctx)
		if ok {
			a.UI.Success("%s", msg)
		} else {
			a.UI.Warn("%s", msg)
		}
	}

	if len(sites.Sites) > 0 {
		var domains []string
		for _, s := range sites.Sites {
			domains = append(domains, s.Domain)
		}
		rows := a.Certs.List(domains)
		if len(rows) > 0 {
			a.UI.Heading("Certificados")
			a.UI.Table([]string{"dominio", "expira", "estado"}, rows)
		}
	}

	if a.Systemd.IsActive(ctx, "devenv-watcher.service") {
		a.UI.Success("watcher activo")
	} else {
		a.UI.Warn("watcher inactivo (devenv doctor --fix)")
	}
	a.checkPorts(ctx, a.Config)
	return nil
}

func (a *App) Doctor(ctx context.Context, fix, dryRun bool) error {
	actions := []string{
		"crear directorios de estado",
		"asegurar red podman devenv",
		"regenerar nginx.conf y unidades Quadlet",
		"regenerar unidades PHP y arrancarlas",
		"revalidar y recargar nginx",
		"instalar shims de mysql/psql/pg_dump",
		"renovar certificados que expiran en menos de 30 días",
	}
	if dryRun {
		a.UI.Heading("devenv doctor --dry-run")
		for _, action := range actions {
			a.UI.Info("  - %s", action)
		}
		return nil
	}
	if !fix {
		a.UI.Heading("devenv doctor")
		return a.Status(ctx)
	}
	return a.withLock(func() error {
		if err := a.Paths.Ensure(); err != nil {
			return err
		}
		if err := a.reloadConfig(); err != nil {
			return err
		}
		if err := a.Podman.Available(ctx); err != nil {
			return err
		}
		if err := a.Podman.NetworkEnsure(ctx); err != nil {
			return err
		}
		if err := a.Nginx.EnsureMain(); err != nil {
			return err
		}
		sites, err := config.LoadSites(a.Paths)
		if err != nil {
			return err
		}
		if _, err := a.Quadlet.InstallNginx(nginxData(a.Config, sites.Sites, a.Paths)); err != nil {
			return err
		}
		exe, _ := os.Executable()
		if _, err := a.Quadlet.InstallWatcher(quadletWatcher(exe)); err != nil {
			return err
		}
		if err := a.syncPHP(ctx, sites.Sites, false); err != nil {
			return err
		}
		if err := a.Systemd.DaemonReload(ctx); err != nil {
			return err
		}
		if err := a.Systemd.Restart(ctx, "devenv-nginx.service"); err != nil {
			return err
		}
		if err := a.waitContainer(ctx, "devenv-nginx", 45*time.Second); err != nil {
			return err
		}
		for _, site := range sites.Sites {
			if site.Secure {
				if renewed, err := a.Certs.RenewIfNeeded(ctx, site.Domain); err != nil {
					a.UI.Warn("certificado %s: %v", site.Domain, err)
				} else if renewed {
					a.UI.Success("certificado renovado: %s", site.Domain)
				}
			}
		}
		if err := a.Nginx.Apply(ctx, sites.Sites); err != nil {
			return err
		}
		if err := a.DB.InstallShims(); err != nil {
			return err
		}
		_ = a.Systemd.EnableNow(ctx, "devenv-watcher.service")
		_ = a.Systemd.Restart(ctx, "devenv-watcher.service")
		a.UI.Success("doctor completado")
		return nil
	})
}

func quadletWatcher(exe string) quadlet.WatcherData {
	return quadlet.WatcherData{Binary: exe}
}

func (a *App) Logs(ctx context.Context, target string, follow bool) error {
	target = strings.TrimSpace(target)
	if target == "" {
		site, err := a.Site("")
		if err != nil {
			return fmt.Errorf("indica un target: nginx, php, php84, mysql:8.4, watcher")
		}
		target = "php" + php.NoDot(site.PHP)
	}
	switch {
	case target == "nginx":
		return a.Podman.Logs(ctx, "devenv-nginx", follow)
	case target == "watcher":
		return a.Systemd.Logs(ctx, "devenv-watcher.service", follow)
	case target == "php":
		site, err := a.Site("")
		if err != nil {
			return err
		}
		return a.Podman.Logs(ctx, php.ContainerName(site.PHP), follow)
	case strings.HasPrefix(target, "php"):
		v := strings.TrimPrefix(target, "php")
		v = strings.ReplaceAll(v, ".", "")
		if len(v) == 2 {
			v = v[:1] + "." + v[1:]
		}
		return a.Podman.Logs(ctx, php.ContainerName(v), follow)
	default:
		def, version, err := service.ParseRef(target, a.Config)
		if err != nil {
			return err
		}
		return a.Podman.Logs(ctx, service.ContainerName(def.Name, version), follow)
	}
}

func (a *App) Watch(ctx context.Context) error {
	if len(a.Config.ParkedDirs) == 0 {
		return fmt.Errorf("no hay parked_dirs configurados")
	}
	for _, dir := range a.Config.ParkedDirs {
		dir = config.ExpandHome(dir)
		if _, err := os.Stat(dir); err != nil {
			a.UI.Warn("parked dir inexistente: %s", dir)
		}
	}
	handler := func(path string) {
		root, err := project.FindRoot(path)
		if err != nil {
			return
		}
		if _, err := a.Link(ctx, root, LinkOptions{Auto: true, Source: "watcher"}); err != nil {
			a.UI.Warn("watcher: %s: %v", filepath.Base(root), err)
		}
	}
	return watcher.Run(ctx, a.Config.ParkedDirs, handler, a.UI)
}

func (a *App) InstallShims() error {
	return a.DB.InstallShims()
}
