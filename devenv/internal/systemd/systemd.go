// Package systemd manages systemd --user units and Quadlet reloads.
package systemd

import (
	"context"
	"fmt"
	"strings"

	"devenv/internal/execx"
)

type Manager struct {
	Runner execx.Runner
}

func (m *Manager) DaemonReload(ctx context.Context) error {
	if _, err := m.Runner.Run(ctx, "systemctl", "--user", "daemon-reload"); err != nil {
		return fmt.Errorf("systemctl --user daemon-reload: %w", err)
	}
	return nil
}

func (m *Manager) Start(ctx context.Context, unit string) error {
	if _, err := m.Runner.Run(ctx, "systemctl", "--user", "start", unit); err != nil {
		return fmt.Errorf("iniciar %s: %w", unit, err)
	}
	return nil
}

func (m *Manager) Stop(ctx context.Context, unit string) error {
	if _, err := m.Runner.Run(ctx, "systemctl", "--user", "stop", unit); err != nil {
		return fmt.Errorf("detener %s: %w", unit, err)
	}
	return nil
}

func (m *Manager) Restart(ctx context.Context, unit string) error {
	if _, err := m.Runner.Run(ctx, "systemctl", "--user", "restart", unit); err != nil {
		return fmt.Errorf("reiniciar %s: %w", unit, err)
	}
	return nil
}

func (m *Manager) EnableNow(ctx context.Context, unit string) error {
	if _, err := m.Runner.Run(ctx, "systemctl", "--user", "enable", "--now", unit); err != nil {
		return fmt.Errorf("habilitar %s: %w", unit, err)
	}
	return nil
}

func (m *Manager) DisableNow(ctx context.Context, unit string) error {
	if _, err := m.Runner.Run(ctx, "systemctl", "--user", "disable", "--now", unit); err != nil {
		return fmt.Errorf("deshabilitar %s: %w", unit, err)
	}
	return nil
}

func (m *Manager) IsActive(ctx context.Context, unit string) bool {
	out, err := m.Runner.Run(ctx, "systemctl", "--user", "is-active", unit)
	return err == nil && strings.TrimSpace(out) == "active"
}

func (m *Manager) Status(ctx context.Context, unit string) (string, error) {
	return m.Runner.Run(ctx, "systemctl", "--user", "status", "--no-pager", unit)
}

func (m *Manager) Logs(ctx context.Context, unit string, follow bool) error {
	args := []string{"--user", "-u", unit, "--no-pager"}
	if follow {
		args = append(args, "-f")
	}
	if follow {
		return m.Runner.RunInteractive(ctx, "journalctl", args...)
	}
	out, err := m.Runner.Run(ctx, "journalctl", args...)
	if out != "" {
		fmt.Print(out)
	}
	return err
}
