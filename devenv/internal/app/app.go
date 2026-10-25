// Package app contains the use cases behind the CLI commands.
package app

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"devenv/internal/certs"
	"devenv/internal/composer"
	"devenv/internal/config"
	"devenv/internal/db"
	"devenv/internal/dns"
	"devenv/internal/execx"
	"devenv/internal/nginx"
	"devenv/internal/node"
	"devenv/internal/php"
	"devenv/internal/podman"
	"devenv/internal/quadlet"
	"devenv/internal/service"
	"devenv/internal/state"
	"devenv/internal/systemd"
	"devenv/internal/tools"
	"devenv/internal/ui"
)

type App struct {
	Paths   config.Paths
	Config  config.Config
	Runner  execx.Runner
	UI      *ui.UI
	Offline bool
	NoPull  bool

	Podman   *podman.Client
	Systemd  *systemd.Manager
	Quadlet  *quadlet.Manager
	Nginx    *nginx.Manager
	PHP      *php.Manager
	Node     *node.Manager
	Composer *composer.Manager
	Certs    *certs.Manager
	DNS      *dns.Manager
	Services *service.Manager
	DB       *db.Manager
}

func New(paths config.Paths, u *ui.UI, runner execx.Runner, offline, noPull bool) (*App, error) {
	cfg, err := config.Load(paths)
	if err != nil {
		return nil, err
	}
	if err := paths.Ensure(); err != nil {
		return nil, err
	}
	a := &App{
		Paths: paths, Config: cfg, Runner: runner, UI: u, Offline: offline, NoPull: noPull,
	}
	a.wire()
	return a, nil
}

func (a *App) wire() {
	a.Podman = &podman.Client{Runner: a.Runner, UI: a.UI, Offline: a.Offline, NoPull: a.NoPull}
	a.Systemd = &systemd.Manager{Runner: a.Runner}
	a.Quadlet = &quadlet.Manager{Paths: a.Paths, Systemd: a.Systemd}
	a.Nginx = &nginx.Manager{Paths: a.Paths, Podman: a.Podman, UI: a.UI, HTTPSPort: a.Config.Nginx.HTTPSPort}
	a.PHP = &php.Manager{Paths: a.Paths, Podman: a.Podman, Systemd: a.Systemd, Quadlet: a.Quadlet, UI: a.UI}
	a.Node = &node.Manager{Paths: a.Paths, Runner: a.Runner, UI: a.UI, Config: a.Config}
	a.Composer = &composer.Manager{Paths: a.Paths, PHP: a.PHP, UI: a.UI, Offline: a.Offline}
	a.Certs = &certs.Manager{Paths: a.Paths, Runner: a.Runner, UI: a.UI, Offline: a.Offline}
	a.DNS = &dns.Manager{Paths: a.Paths, Config: a.Config, Podman: a.Podman, Systemd: a.Systemd, Quadlet: a.Quadlet, UI: a.UI}
	a.Services = &service.Manager{Paths: a.Paths, Config: a.Config, Podman: a.Podman, Systemd: a.Systemd, Quadlet: a.Quadlet, UI: a.UI}
	a.DB = &db.Manager{Paths: a.Paths, Config: a.Config, Podman: a.Podman, Services: a.Services, UI: a.UI}
}

func (a *App) applyConfig(cfg config.Config) {
	a.Config = cfg
	a.Nginx.HTTPSPort = cfg.Nginx.HTTPSPort
	a.Node.Config = cfg
	a.DNS.Config = cfg
	a.Services.Config = cfg
	a.DB.Config = cfg
}

func (a *App) reloadConfig() error {
	cfg, err := config.Load(a.Paths)
	if err != nil {
		return err
	}
	a.applyConfig(cfg)
	return nil
}

func (a *App) withLock(fn func() error) error {
	lock, err := state.Acquire(a.Paths.LockFile)
	if err != nil {
		return err
	}
	defer lock.Release()
	return fn()
}

// Install prepares the host directories, network, nginx and host tools.
func (a *App) Install(ctx context.Context) error {
	return a.withLock(func() error {
		if err := a.Paths.Ensure(); err != nil {
			return err
		}
		cfg := config.DefaultConfigForHome(a.Paths.Home)
		if _, err := os.Stat(a.Paths.ConfigFile); errors.Is(err, os.ErrNotExist) {
			if err := cfg.Save(a.Paths); err != nil {
				return err
			}
		} else if err != nil {
			return err
		}
		if err := a.reloadConfig(); err != nil {
			return err
		}
		cfg = a.Config

		if err := a.Podman.Available(ctx); err != nil {
			return err
		}
		if err := a.Podman.NetworkEnsure(ctx); err != nil {
			return err
		}
		a.checkPorts(ctx, cfg)
		if err := a.Podman.Pull(ctx, cfg.Nginx.Image, false); err != nil {
			return err
		}
		if err := a.Nginx.EnsureMain(); err != nil {
			return err
		}
		sites, err := config.LoadSites(a.Paths)
		if err != nil {
			return err
		}
		if _, err := a.Quadlet.InstallNginx(nginxData(cfg, sites.Sites, a.Paths)); err != nil {
			return err
		}
		if err := a.Systemd.DaemonReload(ctx); err != nil {
			return err
		}
		if err := a.Systemd.Restart(ctx, "devenv-nginx.service"); err != nil {
			return err
		}
		if err := a.waitContainer(ctx, "devenv-nginx", 45*time.Second); err != nil {
			return fmt.Errorf("nginx no arrancó: %w\n%s", err, a.portHint(cfg))
		}
		if out, err := a.Nginx.Test(ctx); err != nil {
			return fmt.Errorf("nginx -t falló tras install:\n%s\n%w", strings.TrimSpace(out), err)
		}

		exe, err := os.Executable()
		if err != nil {
			exe = "devenv"
		}
		if _, err := a.Quadlet.InstallWatcher(quadlet.WatcherData{Binary: exe}); err != nil {
			return err
		}
		if err := a.Systemd.DaemonReload(ctx); err != nil {
			return err
		}
		_ = a.Systemd.EnableNow(ctx, "devenv-watcher.service")
		_ = a.Systemd.Restart(ctx, "devenv-watcher.service")

		for _, tool := range []string{"composer", "mkcert", "fnm"} {
			dest := filepath.Join(a.Paths.BinDir, tool)
			if tool == "composer" {
				dest += ".phar"
			}
			if _, err := tools.Ensure(ctx, tool, dest, a.UI, a.Offline, false); err != nil {
				a.UI.Warn("%v", err)
			}
		}
		if _, err := a.Certs.EnsureTool(ctx); err != nil {
			a.UI.Warn("CA local no instalada todavía: %v", err)
		}
		if err := a.DB.InstallShims(); err != nil {
			return err
		}

		a.UI.Success("devenv instalado")
		a.UI.Info("Configuración: %s", a.Paths.ConfigFile)
		a.UI.Info("Siguiente paso: entra en un proyecto y ejecuta `devenv link`.")
		if cfg.TLD != "localhost" {
			a.DNS.PrintNetworkManagerCommand()
		}
		return nil
	})
}

func nginxData(cfg config.Config, sites []config.Site, paths config.Paths) quadlet.NginxData {
	var mounts []quadlet.SiteMount
	phpUnits := map[string]bool{}
	for _, site := range sites {
		mounts = append(mounts, quadlet.SiteMount{
			HostPath:      site.Path,
			ContainerPath: "/var/www/sites/" + site.Name,
		})
		phpUnits[php.UnitName(site.PHP)] = true
	}
	units := make([]string, 0, len(phpUnits))
	for unit := range phpUnits {
		units = append(units, unit)
	}
	sort.Strings(units)
	return quadlet.NginxData{
		Image: cfg.Nginx.Image, HTTPPort: cfg.Nginx.HTTPPort, HTTPSPort: cfg.Nginx.HTTPSPort,
		NginxConf: paths.NginxConf, NginxConfD: paths.NginxConfD,
		CertsDir: paths.CertsDir, NginxLogs: paths.NginxLogs, Sites: mounts,
		PHPUnits: units,
	}
}

func (a *App) waitContainer(ctx context.Context, name string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if a.Podman.ContainerRunning(ctx, name) {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(500 * time.Millisecond):
		}
	}
	return fmt.Errorf("timeout esperando %s", name)
}

func (a *App) ensureNginx(ctx context.Context) error {
	if a.Podman.ContainerRunning(ctx, "devenv-nginx") {
		return nil
	}
	if err := a.Systemd.Start(ctx, "devenv-nginx.service"); err != nil {
		return fmt.Errorf("iniciar nginx: %w (ejecuta `devenv install` o `devenv doctor --fix`)", err)
	}
	return a.waitContainer(ctx, "devenv-nginx", 45*time.Second)
}

func (a *App) syncPHP(ctx context.Context, sites []config.Site, ensureImages bool) error {
	versions := map[string]bool{}
	for _, site := range sites {
		versions[site.PHP] = true
	}
	// Regenerate units that already exist too. This removes stale bind mounts
	// when a site is unlinked or moves to another PHP version.
	entries, _ := os.ReadDir(a.Paths.QuadletDir)
	for _, entry := range entries {
		name := entry.Name()
		if !strings.HasPrefix(name, "devenv-php") || !strings.HasSuffix(name, ".container") {
			continue
		}
		raw := strings.TrimSuffix(strings.TrimPrefix(name, "devenv-php"), ".container")
		if len(raw) != 2 {
			continue
		}
		version := raw[:1] + "." + raw[1:]
		if !containsString(a.Config.PHP.Supported, version) {
			continue
		}
		if !a.Podman.ImageExists(ctx, php.ImageName(version)) {
			continue
		}
		versions[version] = true
	}
	sorted := make([]string, 0, len(versions))
	for version := range versions {
		sorted = append(sorted, version)
	}
	sort.Strings(sorted)
	for _, version := range sorted {
		if ensureImages {
			if err := a.PHP.EnsureImage(ctx, version, a.Config, false); err != nil {
				return err
			}
		}
		if _, err := a.PHP.SyncUnit(ctx, version, sites); err != nil {
			return err
		}
		if err := a.Systemd.Restart(ctx, php.UnitName(version)); err != nil {
			return err
		}
		if err := a.waitContainer(ctx, php.ContainerName(version), 45*time.Second); err != nil {
			return err
		}
	}
	return nil
}

func containsString(list []string, value string) bool {
	for _, item := range list {
		if item == value {
			return true
		}
	}
	return false
}

func (a *App) applyNginx(ctx context.Context, sites []config.Site) error {
	if err := a.ensureNginx(ctx); err != nil {
		return err
	}
	if _, err := a.Quadlet.InstallNginx(nginxData(a.Config, sites, a.Paths)); err != nil {
		return err
	}
	if err := a.Systemd.DaemonReload(ctx); err != nil {
		return err
	}
	// The nginx unit may need a restart when its site mounts changed.
	if err := a.Systemd.Restart(ctx, "devenv-nginx.service"); err != nil {
		return err
	}
	if err := a.waitContainer(ctx, "devenv-nginx", 45*time.Second); err != nil {
		return err
	}
	return a.Nginx.Apply(ctx, sites)
}

func (a *App) checkPorts(ctx context.Context, cfg config.Config) {
	out, err := a.Runner.Run(ctx, "sysctl", "-n", "net.ipv4.ip_unprivileged_port_start")
	if err != nil {
		return
	}
	start, err := strconv.Atoi(strings.TrimSpace(out))
	if err != nil {
		return
	}
	if cfg.Nginx.HTTPPort < start || cfg.Nginx.HTTPSPort < start {
		a.UI.Warn("Podman rootless no puede abrir %d/%d con net.ipv4.ip_unprivileged_port_start=%d.", cfg.Nginx.HTTPPort, cfg.Nginx.HTTPSPort, start)
		a.UI.Info("Ejecuta (no lo hace devenv):")
		a.UI.Info("  sudo sysctl -w net.ipv4.ip_unprivileged_port_start=%d", minPort(cfg.Nginx.HTTPPort, cfg.Nginx.HTTPSPort))
		a.UI.Info("  echo 'net.ipv4.ip_unprivileged_port_start=%d' | sudo tee /etc/sysctl.d/99-devenv.conf", minPort(cfg.Nginx.HTTPPort, cfg.Nginx.HTTPSPort))
		a.UI.Info("  sudo sysctl --system")
		a.UI.Info("Alternativa sin sudo: configura nginx.http_port=8080 y nginx.https_port=8443.")
	}
}

func (a *App) portHint(cfg config.Config) string {
	return fmt.Sprintf("Si el fallo es de puertos privilegiados, revisa `sysctl net.ipv4.ip_unprivileged_port_start` o usa puertos altos (actual: %d/%d).", cfg.Nginx.HTTPPort, cfg.Nginx.HTTPSPort)
}

func minPort(a, b int) int {
	if a < b {
		return a
	}
	return b
}
