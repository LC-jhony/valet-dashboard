// Package dns configures the optional dnsmasq container for *.test domains.
package dns

import (
	"context"
	"fmt"
	"net"
	"path/filepath"
	"strings"
	"text/template"
	"time"

	assets "devenv/embed"
	"devenv/internal/config"
	"devenv/internal/podman"
	"devenv/internal/quadlet"
	"devenv/internal/state"
	"devenv/internal/systemd"
	"devenv/internal/ui"
)

const image = "docker.io/4km3/dnsmasq:2.90-r3-alpine-3.22.2"

type Manager struct {
	Paths   config.Paths
	Config  config.Config
	Podman  *podman.Client
	Systemd *systemd.Manager
	Quadlet *quadlet.Manager
	UI      *ui.UI
}

func (m *Manager) configPath() string {
	return filepath.Join(m.Paths.DNSDir, "dnsmasq.conf")
}

func (m *Manager) WriteConfig() error {
	raw, err := assets.FS.ReadFile("dnsmasq/dnsmasq.conf.tmpl")
	if err != nil {
		return err
	}
	t, err := template.New("dnsmasq.conf").Option("missingkey=error").Parse(string(raw))
	if err != nil {
		return err
	}
	var b strings.Builder
	if err := t.Execute(&b, map[string]string{"TLD": m.Config.TLD}); err != nil {
		return err
	}
	return state.WriteFile(m.configPath(), []byte(b.String()), 0o644)
}

func (m *Manager) Enable(ctx context.Context) error {
	if m.Config.TLD == "localhost" {
		m.UI.Info("tld=localhost: no se necesita DNS; usa dominios *.localhost")
		return nil
	}
	if err := m.Podman.NetworkEnsure(ctx); err != nil {
		return err
	}
	if err := m.Podman.Pull(ctx, image, false); err != nil {
		return err
	}
	if err := m.WriteConfig(); err != nil {
		return err
	}
	unit, err := m.Quadlet.InstallDNS(quadlet.DNSData{Image: image, ConfigPath: m.configPath()})
	if err != nil {
		return err
	}
	if err := m.Quadlet.Reload(ctx); err != nil {
		return err
	}
	if err := m.Systemd.Restart(ctx, unit); err != nil {
		return err
	}
	m.UI.Success("dnsmasq iniciado en 127.0.0.1:5300")
	m.PrintNetworkManagerCommand()
	return nil
}

func (m *Manager) Disable(ctx context.Context) error {
	if err := m.Systemd.Stop(ctx, "devenv-dnsmasq.service"); err != nil {
		return err
	}
	if err := m.Quadlet.Remove(m.Paths.QuadletDir, "devenv-dnsmasq.container"); err != nil {
		return err
	}
	if err := m.Systemd.DaemonReload(ctx); err != nil {
		return err
	}
	m.UI.Info("dnsmasq detenido. Para quitar el reenvío de NetworkManager:")
	m.UI.Info("  sudo rm -f /etc/NetworkManager/dnsmasq.d/devenv.conf")
	m.UI.Info("  sudo systemctl restart NetworkManager")
	return nil
}

func (m *Manager) Repair(ctx context.Context) error {
	if err := m.WriteConfig(); err != nil {
		return err
	}
	if err := m.Systemd.Restart(ctx, "devenv-dnsmasq.service"); err != nil {
		return err
	}
	m.PrintNetworkManagerCommand()
	return nil
}

func (m *Manager) PrintNetworkManagerCommand() {
	line := fmt.Sprintf("server=/%s/127.0.0.1#5300", m.Config.TLD)
	m.UI.Info("Para que el sistema resuelva *.%s, ejecuta (requiere sudo):", m.Config.TLD)
	m.UI.Info("  echo '%s' | sudo tee /etc/NetworkManager/dnsmasq.d/devenv.conf", line)
	m.UI.Info("  sudo systemctl restart NetworkManager")
}

// Check verifies container status and a probe lookup.
func (m *Manager) Check(ctx context.Context) (bool, string) {
	if m.Config.TLD == "localhost" {
		return true, "tld=localhost: los navegadores resuelven *.localhost sin DNS"
	}
	running := m.Podman.ContainerRunning(ctx, "devenv-dnsmasq")
	probe := "devenv-probe." + m.Config.TLD
	ips, err := net.LookupHost(probe)
	resolved := false
	for _, ip := range ips {
		if ip == "127.0.0.1" || ip == "::1" {
			resolved = true
		}
	}
	switch {
	case running && resolved:
		return true, fmt.Sprintf("DNS OK (%s -> 127.0.0.1)", probe)
	case running && !resolved:
		return false, fmt.Sprintf("dnsmasq corre, pero %s no resuelve; revisa el drop-in de NetworkManager", probe)
	case !running:
		return false, "dnsmasq no está corriendo; ejecuta `devenv dns:enable`"
	default:
		return false, fmt.Sprintf("no se pudo resolver %s: %v", probe, err)
	}
}

// WaitForDNS polls until the probe resolves or the timeout expires.
func (m *Manager) WaitForDNS(timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	probe := "devenv-probe." + m.Config.TLD
	for time.Now().Before(deadline) {
		if ips, err := net.LookupHost(probe); err == nil {
			for _, ip := range ips {
				if ip == "127.0.0.1" {
					return true
				}
			}
		}
		time.Sleep(300 * time.Millisecond)
	}
	return false
}
