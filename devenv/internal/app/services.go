package app

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"devenv/internal/config"
	"devenv/internal/db"
	"devenv/internal/project"
	"devenv/internal/service"
)

func (a *App) ServiceStart(ctx context.Context, ref string) error {
	return a.withLock(func() error {
		inst, _, err := a.Services.Start(ctx, ref, false)
		if err != nil {
			return err
		}
		def, version, err := service.ParseRef(ref, a.Config)
		if err == nil && (def.DBKind != "" || def.Name == "mailpit") {
			cwd, _ := os.Getwd()
			sites, _ := config.LoadSites(a.Paths)
			if r, err := project.Resolve(cwd, a.Config, sites, "", ""); err == nil {
				if def.Name == "mailpit" {
					host := service.ContainerName(def.Name, version)
					if version == a.Services.DefaultVersion(def) {
						host = def.NetworkAlias
					}
					// Solo actualiza proyectos que ya tienen .env; no crea uno suelto
					// en el directorio actual si no es un sitio.
					if _, statErr := os.Stat(filepath.Join(r.Site.Path, ".env")); statErr == nil {
						if err := a.DB.MergeEnv(r.Site.Path, db.MailVars(def, host)); err != nil {
							a.UI.Warn("correo iniciado, pero no se actualizó .env: %v", err)
						}
					}
				} else {
					p := r.Project
					p.Services = []string{def.Name + ":" + version}
					if _, err := a.DB.EnsureProject(ctx, r.Site, p); err != nil {
						a.UI.Warn("servicio iniciado, pero no se preparó la base del proyecto: %v", err)
					}
				}
			}
		}
		if err == nil && def.Name == "mailpit" {
			a.UI.Success("Mailpit %s iniciado · UI http://127.0.0.1:%d · SMTP 127.0.0.1:%d", version, inst.Ports["http"], inst.Ports["smtp"])
			return nil
		}
		a.UI.Success("%s:%s iniciado en 127.0.0.1:%d", inst.Name, inst.Version, inst.Port)
		return nil
	})
}

// MailOptions controls how `devenv mail` starts and exposes Mailpit.
type MailOptions struct {
	Ref  string
	Open bool
	Env  bool
}

// MailInfo is the observable result of starting Mailpit.
type MailInfo struct {
	Service string `json:"service"`
	UI      string `json:"ui"`
	SMTP    string `json:"smtp"`
	Site    string `json:"site,omitempty"`
}

// Mail starts Mailpit, optionally writes the project's .env and opens the UI.
func (a *App) Mail(ctx context.Context, opts MailOptions) (MailInfo, error) {
	var info MailInfo
	err := a.withLock(func() error {
		ref := strings.TrimSpace(opts.Ref)
		if ref == "" {
			ref = "mailpit"
		}
		def, version, err := service.ParseRef(ref, a.Config)
		if err != nil {
			return err
		}
		if def.Name != "mailpit" {
			return fmt.Errorf("%s no es un servidor de correo", def.Name)
		}

		var inst config.ServiceInstance
		if opts.Env {
			cwd, _ := os.Getwd()
			sites, _ := config.LoadSites(a.Paths)
			r, err := project.Resolve(cwd, a.Config, sites, "", "")
			if err != nil {
				return fmt.Errorf("no se pudo resolver el sitio para --env: %w", err)
			}
			inst, _, err = a.DB.EnsureMailEnv(ctx, r.Site, ref)
			if err != nil {
				return err
			}
			info.Site = r.Site.Name
		} else {
			inst, _, err = a.Services.Start(ctx, ref, false)
			if err != nil {
				return err
			}
		}

		info.Service = def.Name + ":" + version
		info.UI = fmt.Sprintf("http://127.0.0.1:%d", inst.Ports["http"])
		info.SMTP = fmt.Sprintf("127.0.0.1:%d", inst.Ports["smtp"])
		if opts.Open {
			if err := openURL(info.UI); err != nil {
				a.UI.Warn("no se pudo abrir el navegador: %v", err)
			}
		}
		return nil
	})
	return info, err
}

// openURL opens a URL with the desktop's default browser.
func openURL(url string) error {
	cmd := exec.Command("xdg-open", url)
	cmd.Stdout = nil
	cmd.Stderr = nil
	return cmd.Start()
}

func (a *App) ServiceStop(ctx context.Context, ref string) error {
	return a.withLock(func() error {
		if err := a.Services.Stop(ctx, ref); err != nil {
			return err
		}
		a.UI.Success("Servicio detenido: %s", ref)
		return nil
	})
}

func (a *App) ServiceRestart(ctx context.Context, ref string) error {
	return a.withLock(func() error {
		if err := a.Services.Restart(ctx, ref); err != nil {
			return err
		}
		a.UI.Success("Servicio reiniciado: %s", ref)
		return nil
	})
}

func (a *App) ServiceStatus(ctx context.Context, ref string) (string, error) {
	return a.Services.Status(ctx, ref)
}

func (a *App) ServiceList(ctx context.Context) ([][]string, error) {
	return a.Services.List(ctx)
}

func (a *App) Snapshot(ctx context.Context, ref, dbName string) (string, error) {
	cwd, _ := os.Getwd()
	if ref == "" {
		ref = db.DefaultRef(cwd, a.Config)
	}
	if dbName == "" {
		if site, err := a.Site(""); err == nil {
			dbName = db.DBName(site.Name)
		}
	}
	if dbName == "" {
		return "", fmt.Errorf("indica --db o ejecuta dentro de un sitio registrado")
	}
	return a.DB.Snapshot(ctx, ref, dbName)
}

func (a *App) Restore(ctx context.Context, file, ref, dbName string) error {
	cwd, _ := os.Getwd()
	if ref == "" {
		ref = db.DefaultRef(cwd, a.Config)
	}
	return a.DB.Restore(ctx, file, ref, dbName)
}
