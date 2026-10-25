// Package nginx renders vhosts and applies them transactionally.
package nginx

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"text/template"
	"time"

	assets "devenv/embed"
	"devenv/internal/config"
	"devenv/internal/podman"
	"devenv/internal/project"
	"devenv/internal/state"
	"devenv/internal/ui"
)

type VhostData struct {
	Domain    string
	DocRoot   string
	NoDot     string
	HTTPSPort int
}

type Manager struct {
	Paths     config.Paths
	Podman    *podman.Client
	UI        *ui.UI
	HTTPSPort int
}

func (m *Manager) EnsureMain() error {
	if _, err := os.Stat(m.Paths.NginxConf); err == nil {
		return nil
	}
	data, err := assets.FS.ReadFile("nginx/nginx.conf.tmpl")
	if err != nil {
		return err
	}
	return state.WriteFile(m.Paths.NginxConf, data, 0o644)
}

func (m *Manager) Render(site config.Site) (string, error) {
	name := "nginx/vhost-http.tmpl"
	if site.Secure {
		name = "nginx/vhost-https.tmpl"
	}
	raw, err := assets.FS.ReadFile(name)
	if err != nil {
		return "", err
	}
	t, err := template.New(filepath.Base(name)).Option("missingkey=error").Parse(string(raw))
	if err != nil {
		return "", err
	}
	httpsPort := m.HTTPSPort
	if httpsPort == 0 {
		httpsPort = 443
	}
	data := VhostData{
		Domain:    site.Domain,
		DocRoot:   project.ContainerDocRoot(site),
		NoDot:     strings.ReplaceAll(site.PHP, ".", ""),
		HTTPSPort: httpsPort,
	}
	var buf strings.Builder
	if err := t.Execute(&buf, data); err != nil {
		return "", fmt.Errorf("renderizar vhost %s: %w", site.Domain, err)
	}
	return buf.String(), nil
}

// Apply writes all vhosts, validates nginx -t and reloads. On any validation
// failure the previous conf.d directory is restored before returning.
func (m *Manager) Apply(ctx context.Context, sites []config.Site) error {
	if err := m.EnsureMain(); err != nil {
		return err
	}
	if !m.Podman.ContainerRunning(ctx, "devenv-nginx") {
		return fmt.Errorf("el contenedor devenv-nginx no está corriendo; ejecuta `devenv install` o `devenv doctor --fix`")
	}

	desired := make(map[string]string, len(sites))
	for _, site := range sites {
		content, err := m.Render(site)
		if err != nil {
			return err
		}
		desired[site.Domain+".conf"] = content
	}

	backup, err := m.backup()
	if err != nil {
		return err
	}
	if err := m.writeDesired(desired); err != nil {
		_ = m.restore(backup)
		return err
	}
	out, err := m.Podman.Exec(ctx, "devenv-nginx", false, "nginx", "-t")
	if err != nil {
		_ = m.restore(backup)
		return fmt.Errorf("nginx -t falló; se restauró la configuración anterior:\n%s\n%w", strings.TrimSpace(out), err)
	}
	if _, err := m.Podman.Exec(ctx, "devenv-nginx", false, "nginx", "-s", "reload"); err != nil {
		_ = m.restore(backup)
		_, _ = m.Podman.Exec(ctx, "devenv-nginx", false, "nginx", "-s", "reload")
		return fmt.Errorf("no se pudo recargar nginx; se restauró la configuración anterior: %w", err)
	}
	return nil
}

func (m *Manager) writeDesired(desired map[string]string) error {
	entries, err := os.ReadDir(m.Paths.NginxConfD)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".conf") {
			continue
		}
		if _, keep := desired[entry.Name()]; !keep {
			if err := state.Remove(filepath.Join(m.Paths.NginxConfD, entry.Name())); err != nil {
				return err
			}
		}
	}
	for name, content := range desired {
		if err := state.WriteFile(filepath.Join(m.Paths.NginxConfD, name), []byte(content), 0o644); err != nil {
			return err
		}
	}
	return nil
}

func (m *Manager) backup() (string, error) {
	dir := filepath.Join(m.Paths.BackupsDir, "nginx", time.Now().UTC().Format("20060102-150405.000000000"))
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	entries, err := os.ReadDir(m.Paths.NginxConfD)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		data, err := os.ReadFile(filepath.Join(m.Paths.NginxConfD, entry.Name()))
		if err != nil {
			return "", err
		}
		if err := os.WriteFile(filepath.Join(dir, entry.Name()), data, 0o600); err != nil {
			return "", err
		}
	}
	return dir, nil
}

func (m *Manager) restore(backup string) error {
	entries, err := os.ReadDir(m.Paths.NginxConfD)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".conf") {
			_ = state.Remove(filepath.Join(m.Paths.NginxConfD, entry.Name()))
		}
	}
	files, err := os.ReadDir(backup)
	if err != nil {
		return err
	}
	for _, entry := range files {
		data, err := os.ReadFile(filepath.Join(backup, entry.Name()))
		if err != nil {
			return err
		}
		if err := state.WriteFile(filepath.Join(m.Paths.NginxConfD, entry.Name()), data, 0o644); err != nil {
			return err
		}
	}
	return nil
}

// Test runs nginx -t inside the running container.
func (m *Manager) Test(ctx context.Context) (string, error) {
	return m.Podman.Exec(ctx, "devenv-nginx", false, "nginx", "-t")
}

// Reload asks the running nginx master to reload its configuration.
func (m *Manager) Reload(ctx context.Context) error {
	_, err := m.Podman.Exec(ctx, "devenv-nginx", false, "nginx", "-s", "reload")
	return err
}
