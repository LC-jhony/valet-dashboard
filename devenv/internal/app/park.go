package app

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"devenv/internal/config"
	"devenv/internal/php"
	"devenv/internal/project"
	"devenv/internal/quadlet"
	"devenv/internal/watcher"
)

// Park registers a directory and links every project currently inside it.
func (a *App) Park(ctx context.Context, dir string) error {
	abs, err := filepath.Abs(config.ExpandHome(dir))
	if err != nil {
		return err
	}
	info, err := os.Stat(abs)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return fmt.Errorf("%s no es un directorio", abs)
	}
	if err := a.withLock(func() error {
		found := false
		for _, p := range a.Config.ParkedDirs {
			if filepath.Clean(p) == abs {
				found = true
			}
		}
		if !found {
			a.Config.ParkedDirs = append(a.Config.ParkedDirs, abs)
			if err := a.Config.Save(a.Paths); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		return err
	}

	projects, err := watcher.Discover(abs)
	if err != nil {
		return err
	}
	for _, p := range projects {
		if _, err := a.Link(ctx, p, LinkOptions{Source: "park"}); err != nil {
			a.UI.Warn("no se pudo registrar %s: %v", filepath.Base(p), err)
		}
	}
	exe, _ := os.Executable()
	if _, err := a.Quadlet.InstallWatcher(quadlet.WatcherData{Binary: exe}); err != nil {
		return err
	}
	if err := a.Systemd.DaemonReload(ctx); err != nil {
		return err
	}
	_ = a.Systemd.EnableNow(ctx, "devenv-watcher.service")
	_ = a.Systemd.Restart(ctx, "devenv-watcher.service")
	a.UI.Success("%s parked (%d proyectos detectados)", abs, len(projects))
	return nil
}

// Unpark removes a directory and all sites below it.
func (a *App) Unpark(ctx context.Context, dir string) error {
	abs, err := filepath.Abs(config.ExpandHome(dir))
	if err != nil {
		return err
	}
	return a.withLock(func() error {
		var keptDirs []string
		for _, p := range a.Config.ParkedDirs {
			if filepath.Clean(p) != abs {
				keptDirs = append(keptDirs, p)
			}
		}
		a.Config.ParkedDirs = keptDirs
		if err := a.Config.Save(a.Paths); err != nil {
			return err
		}
		sites, err := config.LoadSites(a.Paths)
		if err != nil {
			return err
		}
		var kept []config.Site
		for _, s := range sites.Sites {
			if !pathWithin(s.Path, abs) {
				kept = append(kept, s)
			}
		}
		sites.Sites = kept
		if err := a.syncPHP(ctx, sites.Sites, false); err != nil {
			return err
		}
		if err := a.applyNginx(ctx, sites.Sites); err != nil {
			return err
		}
		if err := sites.Save(a.Paths); err != nil {
			return err
		}
		if len(keptDirs) == 0 {
			_ = a.Systemd.DisableNow(ctx, "devenv-watcher.service")
		} else {
			_ = a.Systemd.Restart(ctx, "devenv-watcher.service")
		}
		a.UI.Success("%s unparked", abs)
		return nil
	})
}

func pathWithin(path, dir string) bool {
	rel, err := filepath.Rel(dir, path)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

func (a *App) PHPList(ctx context.Context) error {
	installed, err := a.PHP.ListInstalled(ctx)
	if err != nil {
		return err
	}
	has := map[string]bool{}
	for _, v := range installed {
		has[v] = true
	}
	var current string
	if site, err := a.Site(""); err == nil {
		current = site.PHP
	}
	var rows [][]string
	for _, v := range a.Config.PHP.Supported {
		mark := ""
		if v == a.Config.PHP.Default {
			mark = "global"
		}
		if v == current {
			if mark != "" {
				mark += ", proyecto"
			} else {
				mark = "proyecto"
			}
		}
		img := "no"
		if has[v] {
			img = "sí"
		}
		running := "no"
		if a.Podman.ContainerRunning(ctx, php.ContainerName(v)) {
			running = "sí"
		}
		rows = append(rows, []string{v, mark, img, running})
	}
	a.UI.Table([]string{"PHP", "uso", "imagen", "contenedor"}, rows)
	return nil
}

// ResolveCurrent is a helper for commands that need the effective project.
func (a *App) ResolveCurrent() (project.Resolved, error) {
	cwd, err := os.Getwd()
	if err != nil {
		return project.Resolved{}, err
	}
	sites, err := config.LoadSites(a.Paths)
	if err != nil {
		return project.Resolved{}, err
	}
	return project.Resolve(cwd, a.Config, sites, "", "")
}
