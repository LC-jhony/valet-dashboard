// Package certs manages the local mkcert CA and per-site certificates.
package certs

import (
	"context"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"devenv/internal/config"
	"devenv/internal/execx"
	"devenv/internal/tools"
	"devenv/internal/ui"
)

type Manager struct {
	Paths   config.Paths
	Runner  execx.Runner
	UI      *ui.UI
	Offline bool
}

func (m *Manager) binary() string {
	return filepath.Join(m.Paths.BinDir, "mkcert")
}

// EnsureTool downloads mkcert and, with confirmation, installs its CA.
func (m *Manager) EnsureTool(ctx context.Context) (string, error) {
	path := m.binary()
	if _, err := tools.Ensure(ctx, "mkcert", path, m.UI, m.Offline, false); err != nil {
		return "", err
	}
	if _, err := os.Stat(filepath.Join(m.Paths.CACertsDir, "rootCA.pem")); err == nil {
		return path, nil
	}
	ok, err := m.UI.Confirm("Instalar la CA local de mkcert en el almacén de confianza del sistema (puede pedir permisos)")
	if err != nil {
		return "", err
	}
	if !ok {
		return "", fmt.Errorf("CA no instalada; ejecuta:\n  CAROOT=%s %s -install", m.Paths.CACertsDir, path)
	}
	old, had := os.LookupEnv("CAROOT")
	os.Setenv("CAROOT", m.Paths.CACertsDir)
	defer func() {
		if had {
			os.Setenv("CAROOT", old)
		} else {
			os.Unsetenv("CAROOT")
		}
	}()
	out, err := m.Runner.Run(ctx, path, "-install")
	if err != nil {
		return "", fmt.Errorf("no se pudo instalar la CA (no se ejecutó sudo):\n  CAROOT=%s %s -install\n%s\n%w", m.Paths.CACertsDir, path, strings.TrimSpace(out), err)
	}
	m.UI.Success("CA local instalada")
	return path, nil
}

// Issue creates a certificate and key for domain, replacing an existing pair.
func (m *Manager) Issue(ctx context.Context, domain string) error {
	path, err := m.EnsureTool(ctx)
	if err != nil {
		return err
	}
	cert := filepath.Join(m.Paths.SiteCertsDir, domain+".crt")
	key := filepath.Join(m.Paths.SiteCertsDir, domain+".key")
	old, had := os.LookupEnv("CAROOT")
	os.Setenv("CAROOT", m.Paths.CACertsDir)
	defer func() {
		if had {
			os.Setenv("CAROOT", old)
		} else {
			os.Unsetenv("CAROOT")
		}
	}()
	out, err := m.Runner.Run(ctx, path, "-cert-file", cert, "-key-file", key, domain)
	if err != nil {
		return fmt.Errorf("emitir certificado para %s: %w\n%s", domain, err, strings.TrimSpace(out))
	}
	if err := os.Chmod(key, 0o600); err != nil {
		return err
	}
	if _, err := os.Stat(cert); err != nil {
		return fmt.Errorf("mkcert no generó %s: %w", cert, err)
	}
	m.UI.Success("Certificado emitido para %s", domain)
	return nil
}

// Expiry returns the certificate's NotAfter date.
func (m *Manager) Expiry(domain string) (time.Time, error) {
	path := filepath.Join(m.Paths.SiteCertsDir, domain+".crt")
	data, err := os.ReadFile(path)
	if err != nil {
		return time.Time{}, err
	}
	block, _ := pem.Decode(data)
	if block == nil {
		return time.Time{}, fmt.Errorf("certificado PEM inválido: %s", path)
	}
	cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return time.Time{}, err
	}
	return cert.NotAfter, nil
}

// RenewIfNeeded renews certificates that expire within 30 days.
func (m *Manager) RenewIfNeeded(ctx context.Context, domain string) (bool, error) {
	exp, err := m.Expiry(domain)
	if err != nil {
		return false, nil
	}
	if time.Until(exp) > 30*24*time.Hour {
		return false, nil
	}
	if err := m.Issue(ctx, domain); err != nil {
		return false, err
	}
	return true, nil
}

// List returns certificate expiry rows for status.
func (m *Manager) List(domains []string) [][]string {
	var rows [][]string
	for _, domain := range domains {
		exp, err := m.Expiry(domain)
		if err != nil {
			rows = append(rows, []string{domain, "sin certificado", "-"})
			continue
		}
		days := int(time.Until(exp).Hours() / 24)
		state := fmt.Sprintf("%d días", days)
		if days < 0 {
			state = "expirado"
		} else if days < 30 {
			state = fmt.Sprintf("%d días (renovar)", days)
		}
		rows = append(rows, []string{domain, exp.Format("2006-01-02"), state})
	}
	return rows
}
