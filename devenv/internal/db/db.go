// Package db manages per-project databases, .env blocks and snapshots.
package db

import (
	"compress/gzip"
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"devenv/internal/config"
	"devenv/internal/podman"
	"devenv/internal/project"
	"devenv/internal/service"
	"devenv/internal/state"
	"devenv/internal/ui"
)

const (
	envStart = "# >>> devenv >>>"
	envEnd   = "# <<< devenv <<<"
)

type Manager struct {
	Paths    config.Paths
	Config   config.Config
	Podman   *podman.Client
	Services *service.Manager
	UI       *ui.UI
}

// EnsureProject starts declared services and creates the project's databases
// and credentials. It writes the resulting block to .env.
func (m *Manager) EnsureProject(ctx context.Context, site config.Site, proj config.Project) (map[string]string, error) {
	vars := map[string]string{}
	for _, ref := range proj.Services {
		def, version, err := service.ParseRef(ref, m.Config)
		if err != nil {
			return nil, err
		}
		inst, sec, err := m.Services.Start(ctx, ref, false)
		if err != nil {
			return nil, err
		}
		container := service.ContainerName(def.Name, version)
		host := container
		if version == m.Services.DefaultVersion(def) {
			host = def.NetworkAlias
		}
		switch def.DBKind {
		case "mysql":
			cred, err := m.credential(site.Name)
			if err != nil {
				return nil, err
			}
			if err := m.ensureMySQL(ctx, container, sec.RootPassword, cred); err != nil {
				return nil, err
			}
			vars["DB_CONNECTION"] = "mysql"
			vars["DB_HOST"] = host
			vars["DB_PORT"] = "3306"
			vars["DB_DATABASE"] = cred.DBUser
			vars["DB_USERNAME"] = cred.DBUser
			vars["DB_PASSWORD"] = cred.DBPassword
			m.UI.Info("MySQL: app=%s:3306  host=127.0.0.1:%d  db=%s  user=%s", host, inst.Port, cred.DBUser, cred.DBUser)
		case "postgres":
			cred, err := m.credential(site.Name)
			if err != nil {
				return nil, err
			}
			if err := m.ensurePostgres(ctx, container, sec.RootPassword, cred); err != nil {
				return nil, err
			}
			vars["DB_CONNECTION"] = "pgsql"
			vars["DB_HOST"] = host
			vars["DB_PORT"] = "5432"
			vars["DB_DATABASE"] = cred.DBUser
			vars["DB_USERNAME"] = cred.DBUser
			vars["DB_PASSWORD"] = cred.DBPassword
			m.UI.Info("PostgreSQL: app=%s:5432  host=127.0.0.1:%d  db=%s  user=%s", host, inst.Port, cred.DBUser, cred.DBUser)
		default:
			switch def.Name {
			case "redis":
				vars["REDIS_HOST"] = host
				vars["REDIS_PORT"] = "6379"
				m.UI.Info("Redis: app=%s:6379  host=127.0.0.1:%d", host, inst.Port)
			case "meilisearch":
				vars["MEILISEARCH_HOST"] = "http://" + host + ":7700"
				vars["MEILISEARCH_KEY"] = sec.RootPassword
				m.UI.Info("Meilisearch: app=http://%s:7700  host=http://127.0.0.1:%d", host, inst.Port)
			case "mailpit":
				vars["MAIL_MAILER"] = "smtp"
				vars["MAIL_HOST"] = host
				vars["MAIL_PORT"] = "1025"
				m.UI.Info("Mailpit: app=%s:1025  web=http://127.0.0.1:%d", host, inst.Ports["http"])
			}
		}
	}
	if len(vars) > 0 {
		if err := m.WriteEnv(site.Path, vars); err != nil {
			return nil, err
		}
	}
	return vars, nil
}

func (m *Manager) credential(projectName string) (config.ProjectCredential, error) {
	secrets, err := config.LoadSecrets(m.Paths)
	if err != nil {
		return config.ProjectCredential{}, err
	}
	cred, ok := secrets.Projects[projectName]
	if !ok || cred.DBUser == "" {
		cred = config.ProjectCredential{
			DBUser:     DBName(projectName),
			DBPassword: randomPassword(24),
		}
		secrets.Projects[projectName] = cred
		if err := secrets.Save(m.Paths); err != nil {
			return config.ProjectCredential{}, err
		}
	}
	return cred, nil
}

func (m *Manager) ensureMySQL(ctx context.Context, container, root string, cred config.ProjectCredential) error {
	db := DBName(cred.DBUser)
	user := DBName(cred.DBUser)
	sql := fmt.Sprintf(
		"CREATE DATABASE IF NOT EXISTS `%s` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; "+
			"CREATE USER IF NOT EXISTS '%s'@'%%' IDENTIFIED BY '%s'; "+
			"ALTER USER '%s'@'%%' IDENTIFIED BY '%s'; "+
			"GRANT ALL PRIVILEGES ON `%s`.* TO '%s'@'%%'; FLUSH PRIVILEGES;",
		db, user, cred.DBPassword, user, cred.DBPassword, db, user,
	)
	_, err := m.Podman.ExecWith(ctx, container, podman.ExecOptions{
		Env: []string{"MYSQL_PWD=" + root},
	}, "mysql", "-uroot", "-h", "127.0.0.1", "-e", sql)
	if err != nil {
		return fmt.Errorf("crear base MySQL %s: %w", db, err)
	}
	return nil
}

func (m *Manager) ensurePostgres(ctx context.Context, container, root string, cred config.ProjectCredential) error {
	user := DBName(cred.DBUser)
	db := user
	env := []string{"PGPASSWORD=" + root}
	psql := func(args ...string) (string, error) {
		return m.Podman.ExecWith(ctx, container, podman.ExecOptions{Env: env}, append([]string{"psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1"}, args...)...)
	}
	exists, err := psql("-tAc", fmt.Sprintf("SELECT 1 FROM pg_roles WHERE rolname='%s'", user))
	if err != nil {
		return fmt.Errorf("consultar rol PostgreSQL: %w", err)
	}
	if strings.TrimSpace(exists) != "1" {
		if _, err := psql("-c", fmt.Sprintf("CREATE ROLE %s LOGIN PASSWORD '%s'", user, cred.DBPassword)); err != nil {
			return fmt.Errorf("crear rol PostgreSQL: %w", err)
		}
	} else {
		if _, err := psql("-c", fmt.Sprintf("ALTER ROLE %s WITH LOGIN PASSWORD '%s'", user, cred.DBPassword)); err != nil {
			return fmt.Errorf("actualizar contraseña del rol PostgreSQL: %w", err)
		}
	}
	exists, err = psql("-tAc", fmt.Sprintf("SELECT 1 FROM pg_database WHERE datname='%s'", db))
	if err != nil {
		return fmt.Errorf("consultar base PostgreSQL: %w", err)
	}
	if strings.TrimSpace(exists) != "1" {
		if _, err := m.Podman.ExecWith(ctx, container, podman.ExecOptions{Env: env}, "createdb", "-U", "postgres", "-O", user, db); err != nil {
			return fmt.Errorf("crear base PostgreSQL %s: %w", db, err)
		}
	}
	if _, err := psql("-d", db, "-c", fmt.Sprintf("GRANT ALL ON SCHEMA public TO %s", user)); err != nil {
		return fmt.Errorf("otorgar permisos PostgreSQL: %w", err)
	}
	return nil
}

// WriteEnv replaces only the devenv-managed block in .env.
func (m *Manager) WriteEnv(root string, vars map[string]string) error {
	path := filepath.Join(root, ".env")
	var existing string
	if data, err := os.ReadFile(path); err == nil {
		existing = string(data)
		if err := state.WriteFile(path+".devenv.bak", data, 0o600); err != nil {
			return err
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}

	start := strings.Index(existing, envStart)
	end := strings.Index(existing, envEnd)
	if start >= 0 && end > start {
		existing = existing[:start] + existing[end+len(envEnd):]
	}
	existing = strings.TrimRight(existing, "\n")
	var b strings.Builder
	if existing != "" {
		b.WriteString(existing)
		b.WriteString("\n\n")
	}
	b.WriteString(envStart)
	b.WriteString("\n")
	keys := make([]string, 0, len(vars))
	for k := range vars {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		b.WriteString(k)
		b.WriteString("=")
		b.WriteString(vars[k])
		b.WriteString("\n")
	}
	b.WriteString(envEnd)
	b.WriteString("\n")
	return state.WriteFile(path, []byte(b.String()), 0o600)
}

func DBName(name string) string {
	name = project.SanitizeName(name)
	name = strings.ReplaceAll(name, "-", "_")
	name = strings.ReplaceAll(name, ".", "_")
	if name == "" {
		name = "devenv"
	}
	if len(name) > 60 {
		name = name[:60]
	}
	return name
}

func DefaultRef(root string, cfg config.Config) string {
	if proj, ok, _ := config.LoadProject(root); ok {
		for _, ref := range proj.Services {
			def, _, err := service.ParseRef(ref, cfg)
			if err == nil && def.DBKind != "" {
				return ref
			}
		}
	}
	if sc, ok := cfg.Services["mysql"]; ok {
		return "mysql:" + sc.Version
	}
	return "mysql"
}

// Snapshot writes a gzip SQL dump to the snapshots directory.
func (m *Manager) Snapshot(ctx context.Context, ref, dbName string) (string, error) {
	def, version, err := service.ParseRef(ref, m.Config)
	if err != nil {
		return "", err
	}
	if def.DBKind == "" {
		return "", fmt.Errorf("%s no es una base de datos", def.Name)
	}
	if dbName == "" {
		return "", fmt.Errorf("indica la base de datos con --db")
	}
	dbName = DBName(dbName)
	inst, sec, err := m.instance(def, version)
	if err != nil {
		return "", err
	}
	container := service.ContainerName(def.Name, version)
	var stdout, stderr string
	switch def.DBKind {
	case "mysql":
		stdout, stderr, err = m.Podman.ExecSplit(ctx, container, podman.ExecOptions{
			Env: []string{"MYSQL_PWD=" + sec.RootPassword},
		}, "mysqldump", "-uroot", "-h", "127.0.0.1", "--single-transaction", "--routines", "--triggers", "--databases", dbName)
	case "postgres":
		stdout, stderr, err = m.Podman.ExecSplit(ctx, container, podman.ExecOptions{
			Env: []string{"PGPASSWORD=" + sec.RootPassword},
		}, "pg_dump", "-U", "postgres", "-d", dbName)
	}
	if err != nil {
		return "", fmt.Errorf("snapshot de %s: %w\n%s", dbName, err, strings.TrimSpace(stderr))
	}
	dir := filepath.Join(m.Paths.SnapshotsDir, def.Name+"-"+version)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	path := filepath.Join(dir, fmt.Sprintf("%s-%s.sql.gz", dbName, time.Now().UTC().Format("20060102-150405")))
	if err := writeGzip(path, []byte(stdout)); err != nil {
		return "", err
	}
	m.UI.Success("Snapshot guardado en %s (%s, puerto %d)", path, def.Name+":"+version, inst.Port)
	return path, nil
}

// Restore takes a safety snapshot and then restores a gzip SQL dump.
func (m *Manager) Restore(ctx context.Context, file, ref, dbName string) error {
	def, version, err := service.ParseRef(ref, m.Config)
	if err != nil {
		return err
	}
	if def.DBKind == "" {
		return fmt.Errorf("%s no es una base de datos", def.Name)
	}
	if dbName == "" {
		dbName = dbNameFromSnapshot(file)
	}
	if dbName == "" {
		return fmt.Errorf("no se pudo inferir la base de datos; usa --db")
	}
	dbName = DBName(dbName)
	pre, err := m.Snapshot(ctx, ref, dbName)
	if err != nil {
		return fmt.Errorf("no se restauró nada: falló el snapshot de seguridad: %w", err)
	}
	f, err := os.Open(file)
	if err != nil {
		return err
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return fmt.Errorf("snapshot inválido %s: %w", file, err)
	}
	defer gz.Close()

	_, sec, err := m.instance(def, version)
	if err != nil {
		return err
	}
	container := service.ContainerName(def.Name, version)
	switch def.DBKind {
	case "mysql":
		_, err = m.Podman.ExecInput(ctx, container, podman.ExecOptions{
			Interactive: true,
			Env:         []string{"MYSQL_PWD=" + sec.RootPassword},
		}, gz, "mysql", "-uroot", "-h", "127.0.0.1", dbName)
	case "postgres":
		_, err = m.Podman.ExecInput(ctx, container, podman.ExecOptions{
			Interactive: true,
			Env:         []string{"PGPASSWORD=" + sec.RootPassword},
		}, gz, "psql", "-U", "postgres", "-d", dbName)
	}
	if err != nil {
		return fmt.Errorf("restaurar %s falló; snapshot previo: %s: %w", dbName, pre, err)
	}
	m.UI.Success("Base %s restaurada desde %s (snapshot previo: %s)", dbName, file, pre)
	return nil
}

func (m *Manager) instance(def service.Definition, version string) (config.ServiceInstance, config.ServiceSecret, error) {
	state, err := config.LoadServiceState(m.Paths)
	if err != nil {
		return config.ServiceInstance{}, config.ServiceSecret{}, err
	}
	inst, ok := state.Services[service.Key(def.Name, version)]
	if !ok {
		return config.ServiceInstance{}, config.ServiceSecret{}, fmt.Errorf("el servicio %s:%s no está iniciado", def.Name, version)
	}
	secrets, err := config.LoadSecrets(m.Paths)
	if err != nil {
		return config.ServiceInstance{}, config.ServiceSecret{}, err
	}
	sec, ok := secrets.Services[def.Name+"-"+version]
	if !ok {
		return config.ServiceInstance{}, config.ServiceSecret{}, fmt.Errorf("faltan credenciales para %s:%s", def.Name, version)
	}
	return inst, sec, nil
}

func writeGzip(path string, data []byte) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), ".snapshot-*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	gz := gzip.NewWriter(tmp)
	if _, err := gz.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := gz.Close(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmpName, path); err != nil {
		return err
	}
	return os.Chmod(path, 0o600)
}

func dbNameFromSnapshot(path string) string {
	base := filepath.Base(path)
	if i := strings.Index(base, "-20"); i > 0 {
		return base[:i]
	}
	base = strings.TrimSuffix(base, ".gz")
	base = strings.TrimSuffix(base, ".sql")
	return base
}

// InstallShims writes host wrappers for mysql, psql and pg_dump.
func (m *Manager) InstallShims() error {
	exe, err := os.Executable()
	if err != nil {
		exe = "devenv"
	}
	exe = strings.ReplaceAll(exe, "'", "'\\''")
	for _, tool := range []string{"mysql", "psql", "pg_dump"} {
		script := fmt.Sprintf("#!/bin/sh\nexec '%s' shim %s \"$@\"\n", exe, tool)
		if err := state.WriteFile(filepath.Join(m.Paths.BinDir, tool), []byte(script), 0o755); err != nil {
			return err
		}
	}
	m.UI.Info("Shims instalados en %s (añade ese directorio al PATH)", m.Paths.BinDir)
	return nil
}

// Shim dispatches a host client into the matching service container.
func (m *Manager) Shim(ctx context.Context, tool string, args []string) error {
	ref := os.Getenv("DEVENV_SERVICE")
	if ref == "" {
		switch tool {
		case "mysql":
			ref = "mysql"
		case "psql", "pg_dump":
			ref = "postgres"
		default:
			return fmt.Errorf("shim desconocido: %s", tool)
		}
	}
	def, version, err := service.ParseRef(ref, m.Config)
	if err != nil {
		return err
	}
	_, sec, err := m.instance(def, version)
	if err != nil {
		return err
	}
	container := service.ContainerName(def.Name, version)
	switch tool {
	case "mysql":
		call := append([]string{"mysql", "-h", "127.0.0.1", "-u", "root"}, args...)
		return m.Podman.ExecAttach(ctx, container, true, podman.ExecOptions{
			Env: []string{"MYSQL_PWD=" + sec.RootPassword},
		}, call...)
	case "psql":
		call := append([]string{"psql", "-U", "postgres"}, args...)
		return m.Podman.ExecAttach(ctx, container, true, podman.ExecOptions{
			Env: []string{"PGPASSWORD=" + sec.RootPassword},
		}, call...)
	case "pg_dump":
		call := append([]string{"pg_dump", "-U", "postgres"}, args...)
		return m.Podman.ExecAttach(ctx, container, false, podman.ExecOptions{
			Env: []string{"PGPASSWORD=" + sec.RootPassword},
		}, call...)
	}
	return fmt.Errorf("shim desconocido: %s", tool)
}

func randomPassword(n int) string {
	const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return "devenv-change-me"
	}
	for i := range buf {
		buf[i] = alphabet[int(buf[i])%len(alphabet)]
	}
	return string(buf)
}
