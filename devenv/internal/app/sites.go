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
)

type LinkOptions struct {
	Name   string
	Domain string
	Auto   bool
	Source string
}

// Link registers a project, generates its vhost and starts its PHP runtime.
func (a *App) Link(ctx context.Context, start string, opts LinkOptions) (config.Site, error) {
	var site config.Site
	err := a.withLock(func() error {
		sites, err := config.LoadSites(a.Paths)
		if err != nil {
			return err
		}
		r, err := project.Resolve(start, a.Config, sites, opts.Domain, opts.Name)
		if err != nil {
			return err
		}
		if idx, ok := sites.Find(r.Name); ok && filepath.Clean(sites.Sites[idx].Path) != filepath.Clean(r.Root) {
			return fmt.Errorf("el nombre %q ya está registrado para %s; usa --name", r.Name, sites.Sites[idx].Path)
		}
		if opts.Source != "" {
			r.Site.Source = opts.Source
		}
		if err := a.Podman.NetworkEnsure(ctx); err != nil {
			return err
		}
		if opts.Auto && !a.Podman.ImageExists(ctx, php.ImageName(r.PHP)) {
			return fmt.Errorf("PHP %s aún no está construido; ejecuta `devenv link` manualmente una vez", r.PHP)
		}

		updated := sites
		if idx, ok := updated.FindByPath(r.Root); ok {
			updated.Sites[idx] = r.Site
		} else {
			updated.Sites = append(updated.Sites, r.Site)
		}

		if r.Site.Secure {
			if err := a.Certs.Issue(ctx, r.Site.Domain); err != nil {
				return err
			}
		}
		if err := a.PHP.EnsureImage(ctx, r.PHP, a.Config, false); err != nil {
			return err
		}
		if err := a.syncPHP(ctx, updated.Sites, false); err != nil {
			return err
		}
		if err := a.applyNginx(ctx, updated.Sites); err != nil {
			return err
		}
		if err := updated.Save(a.Paths); err != nil {
			return err
		}
		site = r.Site

		if !opts.Auto && len(r.Project.Services) > 0 {
			if _, err := a.DB.EnsureProject(ctx, r.Site, r.Project); err != nil {
				a.UI.Warn("el sitio está registrado, pero no se pudieron preparar los servicios: %v", err)
			}
		}
		return nil
	})
	if err != nil {
		return config.Site{}, err
	}
	scheme := "http"
	port := a.Config.Nginx.HTTPPort
	if site.Secure {
		scheme = "https"
		port = a.Config.Nginx.HTTPSPort
	}
	url := fmt.Sprintf("%s://%s", scheme, site.Domain)
	if port != 80 && port != 443 {
		url = fmt.Sprintf("%s:%d", url, port)
	}
	a.UI.Success("Sitio %s registrado (PHP %s, %s)", site.Name, site.PHP, site.Domain)
	a.UI.Link(url)
	return site, nil
}

// Unlink removes a site by name or path.
func (a *App) Unlink(ctx context.Context, nameOrPath string) error {
	return a.withLock(func() error {
		sites, err := config.LoadSites(a.Paths)
		if err != nil {
			return err
		}
		idx, found := sites.Find(nameOrPath)
		if !found {
			if strings.TrimSpace(nameOrPath) == "" {
				if current, err := a.Site(""); err == nil {
					idx, found = sites.Find(current.Name)
				}
			} else if abs, err := filepath.Abs(nameOrPath); err == nil {
				if i, ok := sites.FindByPath(abs); ok {
					idx, found = i, true
				}
			}
		}
		if !found {
			return fmt.Errorf("sitio no encontrado: %s", nameOrPath)
		}
		removed := sites.Sites[idx]
		sites.Sites = append(sites.Sites[:idx], sites.Sites[idx+1:]...)
		if err := a.syncPHP(ctx, sites.Sites, false); err != nil {
			return err
		}
		if err := a.applyNginx(ctx, sites.Sites); err != nil {
			return err
		}
		if err := sites.Save(a.Paths); err != nil {
			return err
		}
		a.UI.Success("Sitio %s eliminado (los archivos y datos no se tocaron)", removed.Name)
		return nil
	})
}

func (a *App) Sites() ([]config.Site, error) {
	sites, err := config.LoadSites(a.Paths)
	if err != nil {
		return nil, err
	}
	return sites.Sites, nil
}

func (a *App) Site(name string) (config.Site, error) {
	sites, err := config.LoadSites(a.Paths)
	if err != nil {
		return config.Site{}, err
	}
	if name == "" {
		cwd, _ := os.Getwd()
		if idx, ok := sites.FindByPath(cwd); ok {
			return sites.Sites[idx], nil
		}
		root, err := project.FindRoot(cwd)
		if err == nil {
			if idx, ok := sites.FindByPath(root); ok {
				return sites.Sites[idx], nil
			}
		}
		return config.Site{}, fmt.Errorf("no estás dentro de un sitio registrado; indica un nombre")
	}
	if idx, ok := sites.Find(name); ok {
		return sites.Sites[idx], nil
	}
	if idx, ok := sites.FindByDomain(name); ok {
		return sites.Sites[idx], nil
	}
	if abs, err := filepath.Abs(name); err == nil {
		if idx, ok := sites.FindByPath(abs); ok {
			return sites.Sites[idx], nil
		}
	}
	return config.Site{}, fmt.Errorf("sitio no encontrado: %s", name)
}

// UsePHP changes the global default and refreshes sites without an explicit
// PHP override.
func (a *App) UsePHP(ctx context.Context, version string) error {
	return a.withLock(func() error {
		v, err := project.NormalizePHPVersion(version, a.Config.PHP.Supported)
		if err != nil {
			return err
		}
		sites, err := config.LoadSites(a.Paths)
		if err != nil {
			return err
		}
		if err := a.PHP.EnsureImage(ctx, v, a.Config, false); err != nil {
			return err
		}
		a.Config.PHP.Default = v
		refreshed := make([]config.Site, 0, len(sites.Sites))
		for _, site := range sites.Sites {
			ns, err := project.RefreshSite(site, a.Config, sites)
			if err != nil {
				a.UI.Warn("no se pudo recalcular %s: %v", site.Name, err)
				ns = site
			}
			refreshed = append(refreshed, ns)
		}
		if err := a.syncPHP(ctx, refreshed, false); err != nil {
			return err
		}
		if err := a.applyNginx(ctx, refreshed); err != nil {
			return err
		}
		sites.Sites = refreshed
		if err := sites.Save(a.Paths); err != nil {
			return err
		}
		if err := a.Config.Save(a.Paths); err != nil {
			return err
		}
		a.UI.Success("PHP global: %s", v)
		return nil
	})
}

// IsolatePHP writes .php-version and updates the current site.
func (a *App) IsolatePHP(ctx context.Context, version string) error {
	return a.withLock(func() error {
		v, err := project.NormalizePHPVersion(version, a.Config.PHP.Supported)
		if err != nil {
			return err
		}
		cwd, err := os.Getwd()
		if err != nil {
			return err
		}
		root, err := project.FindRoot(cwd)
		if err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(root, ".php-version"), []byte(v+"\n"), 0o644); err != nil {
			return err
		}
		if err := a.PHP.EnsureImage(ctx, v, a.Config, false); err != nil {
			return err
		}
		sites, err := config.LoadSites(a.Paths)
		if err != nil {
			return err
		}
		if idx, ok := sites.FindByPath(root); ok {
			r, err := project.Resolve(root, a.Config, sites, "", "")
			if err != nil {
				return err
			}
			r.Site.Source = sites.Sites[idx].Source
			r.Site.Secure = sites.Sites[idx].Secure
			sites.Sites[idx] = r.Site
			if err := a.syncPHP(ctx, sites.Sites, false); err != nil {
				return err
			}
			if err := a.applyNginx(ctx, sites.Sites); err != nil {
				return err
			}
			if err := sites.Save(a.Paths); err != nil {
				return err
			}
		}
		a.UI.Success("PHP %s fijado en %s", v, filepath.Join(root, ".php-version"))
		return nil
	})
}

func (a *App) PHPRebuild(ctx context.Context, version string) error {
	return a.withLock(func() error {
		v, err := project.NormalizePHPVersion(version, a.Config.PHP.Supported)
		if err != nil {
			return err
		}
		if err := a.PHP.EnsureImage(ctx, v, a.Config, true); err != nil {
			return err
		}
		sites, err := config.LoadSites(a.Paths)
		if err != nil {
			return err
		}
		if _, err := a.PHP.SyncUnit(ctx, v, sites.Sites); err != nil {
			return err
		}
		if err := a.Systemd.Restart(ctx, php.UnitName(v)); err != nil {
			return err
		}
		if err := a.waitContainer(ctx, php.ContainerName(v), 45*time.Second); err != nil {
			return err
		}
		a.UI.Success("PHP %s reconstruido y reiniciado", v)
		return nil
	})
}

func (a *App) PHPExec(ctx context.Context, args []string) error {
	cwd, _ := os.Getwd()
	sites, err := config.LoadSites(a.Paths)
	if err != nil {
		return err
	}
	r, err := project.Resolve(cwd, a.Config, sites, "", "")
	if err != nil {
		return err
	}
	out, err := a.PHP.Exec(ctx, r.PHP, r.Site, true, args...)
	if out != "" {
		fmt.Fprint(a.UI.Out, out)
	}
	return err
}

func (a *App) ComposerExec(ctx context.Context, args []string) error {
	cwd, _ := os.Getwd()
	sites, err := config.LoadSites(a.Paths)
	if err != nil {
		return err
	}
	r, err := project.Resolve(cwd, a.Config, sites, "", "")
	if err != nil {
		return err
	}
	return a.Composer.Run(ctx, r, args, true)
}

func (a *App) NodeExec(ctx context.Context, tool string, args []string) error {
	cwd, _ := os.Getwd()
	sites, err := config.LoadSites(a.Paths)
	if err != nil {
		return err
	}
	r, err := project.Resolve(cwd, a.Config, sites, "", "")
	if err != nil {
		return err
	}
	return a.Node.Run(ctx, tool, args, r, true)
}

func (a *App) IsolateNode(ctx context.Context, version string) error {
	cwd, err := os.Getwd()
	if err != nil {
		return err
	}
	root, err := project.FindRoot(cwd)
	if err != nil {
		return err
	}
	return a.Node.Isolate(ctx, version, root)
}

// Secure enables HTTPS for a site.
func (a *App) Secure(ctx context.Context, name string) error {
	return a.withLock(func() error {
		site, err := a.Site(name)
		if err != nil {
			return err
		}
		if err := a.Certs.Issue(ctx, site.Domain); err != nil {
			return err
		}
		sites, err := config.LoadSites(a.Paths)
		if err != nil {
			return err
		}
		idx, ok := sites.Find(site.Name)
		if !ok {
			return fmt.Errorf("sitio no encontrado: %s", site.Name)
		}
		sites.Sites[idx].Secure = true
		sites.Sites[idx].UpdatedAt = time.Now().UTC()
		if err := a.applyNginx(ctx, sites.Sites); err != nil {
			return err
		}
		if err := sites.Save(a.Paths); err != nil {
			return err
		}
		a.UI.Success("HTTPS activo para %s", site.Domain)
		return nil
	})
}
