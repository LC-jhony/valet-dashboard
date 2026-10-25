// Package composer installs a pinned composer.phar and runs it inside PHP-FPM.
package composer

import (
	"context"
	"fmt"
	"path/filepath"

	"devenv/internal/config"
	"devenv/internal/php"
	"devenv/internal/project"
	"devenv/internal/tools"
	"devenv/internal/ui"
)

type Manager struct {
	Paths   config.Paths
	PHP     *php.Manager
	UI      *ui.UI
	Offline bool
}

func (m *Manager) Ensure(ctx context.Context) (string, error) {
	dest := filepath.Join(m.Paths.BinDir, "composer.phar")
	if _, err := tools.Ensure(ctx, "composer", dest, m.UI, m.Offline, false); err != nil {
		return "", err
	}
	return dest, nil
}

func (m *Manager) Run(ctx context.Context, r project.Resolved, args []string, interactive bool) error {
	if _, err := m.Ensure(ctx); err != nil {
		return err
	}
	call := append([]string{"/opt/devenv/bin/composer.phar"}, args...)
	out, err := m.PHP.Exec(ctx, r.PHP, r.Site, interactive, call...)
	if out != "" {
		fmt.Fprint(m.UI.Out, out)
	}
	return err
}
