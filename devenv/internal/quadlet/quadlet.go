// Package quadlet renders and installs Podman Quadlet units.
package quadlet

import (
	"bytes"
	"context"
	"fmt"
	"path/filepath"
	"text/template"

	assets "devenv/embed"
	"devenv/internal/config"
	"devenv/internal/state"
	"devenv/internal/systemd"
)

type SiteMount struct {
	HostPath      string
	ContainerPath string
}

type NginxData struct {
	Image      string
	HTTPPort   int
	HTTPSPort  int
	NginxConf  string
	NginxConfD string
	CertsDir   string
	NginxLogs  string
	Sites      []SiteMount
	PHPUnits   []string
}

type PHPData struct {
	Version string
	NoDot   string
	Image   string
	BinDir  string
	Sites   []SiteMount
}

type ServiceData struct {
	Name          string
	Version       string
	ContainerName string
	Image         string
	NetworkAlias  string
	Volumes       []string
	Env           []string
	PublishPorts  []string
	HealthCmd     string
	Exec          string
}

type DNSData struct {
	Image      string
	ConfigPath string
}

type WatcherData struct {
	Binary string
}

type Manager struct {
	Paths   config.Paths
	Systemd *systemd.Manager
}

func (m *Manager) render(name string, data any) (string, error) {
	raw, err := assets.FS.ReadFile(name)
	if err != nil {
		return "", err
	}
	t, err := template.New(filepath.Base(name)).Option("missingkey=error").Parse(string(raw))
	if err != nil {
		return "", fmt.Errorf("plantilla %s: %w", name, err)
	}
	var buf bytes.Buffer
	if err := t.Execute(&buf, data); err != nil {
		return "", fmt.Errorf("renderizar %s: %w", name, err)
	}
	return buf.String(), nil
}

func (m *Manager) write(path, content string) error {
	return state.WriteFile(path, []byte(content), 0o644)
}

func (m *Manager) InstallNginx(data NginxData) (string, error) {
	content, err := m.render("quadlet/nginx.container.tmpl", data)
	if err != nil {
		return "", err
	}
	if err := m.write(filepath.Join(m.Paths.QuadletDir, "devenv-nginx.container"), content); err != nil {
		return "", err
	}
	return "devenv-nginx.service", nil
}

func (m *Manager) InstallPHP(data PHPData) (string, error) {
	content, err := m.render("quadlet/php.container.tmpl", data)
	if err != nil {
		return "", err
	}
	name := "devenv-php" + data.NoDot + ".container"
	if err := m.write(filepath.Join(m.Paths.QuadletDir, name), content); err != nil {
		return "", err
	}
	return "devenv-php" + data.NoDot + ".service", nil
}

func (m *Manager) InstallService(data ServiceData) (string, error) {
	content, err := m.render("quadlet/service.container.tmpl", data)
	if err != nil {
		return "", err
	}
	name := data.ContainerName + ".container"
	if err := m.write(filepath.Join(m.Paths.QuadletDir, name), content); err != nil {
		return "", err
	}
	return data.ContainerName + ".service", nil
}

func (m *Manager) InstallDNS(data DNSData) (string, error) {
	content, err := m.render("quadlet/dnsmasq.container.tmpl", data)
	if err != nil {
		return "", err
	}
	if err := m.write(filepath.Join(m.Paths.QuadletDir, "devenv-dnsmasq.container"), content); err != nil {
		return "", err
	}
	return "devenv-dnsmasq.service", nil
}

func (m *Manager) InstallWatcher(data WatcherData) (string, error) {
	content, err := m.render("systemd/watcher.service.tmpl", data)
	if err != nil {
		return "", err
	}
	if err := m.write(filepath.Join(m.Paths.SystemdUserDir, "devenv-watcher.service"), content); err != nil {
		return "", err
	}
	return "devenv-watcher.service", nil
}

func (m *Manager) Reload(ctx context.Context) error {
	return m.Systemd.DaemonReload(ctx)
}

// Remove deletes a managed unit file. It does not stop the unit first.
func (m *Manager) Remove(dir, name string) error {
	return removeIfExists(filepath.Join(dir, name))
}

func removeIfExists(path string) error {
	return state.Remove(path)
}
