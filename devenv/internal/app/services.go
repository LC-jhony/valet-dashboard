package app

import (
	"context"
	"fmt"
	"os"

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
		if err == nil && def.DBKind != "" {
			cwd, _ := os.Getwd()
			sites, _ := config.LoadSites(a.Paths)
			if r, err := project.Resolve(cwd, a.Config, sites, "", ""); err == nil {
				p := r.Project
				p.Services = []string{def.Name + ":" + version}
				if _, err := a.DB.EnsureProject(ctx, r.Site, p); err != nil {
					a.UI.Warn("servicio iniciado, pero no se preparó la base del proyecto: %v", err)
				}
			}
		}
		a.UI.Success("%s:%s iniciado en 127.0.0.1:%d", inst.Name, inst.Version, inst.Port)
		return nil
	})
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
