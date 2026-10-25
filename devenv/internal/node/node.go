// Package node runs Node.js tools through fnm or mise on the host.
package node

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"devenv/internal/config"
	"devenv/internal/execx"
	"devenv/internal/project"
	"devenv/internal/state"
	"devenv/internal/ui"
)

type Manager struct {
	Paths  config.Paths
	Runner execx.Runner
	UI     *ui.UI
	Config config.Config
}

type Tool struct {
	Name string // fnm | mise
	Path string
}

func (m *Manager) Detect() (Tool, error) {
	pref := strings.ToLower(strings.TrimSpace(m.Config.Node.Manager))
	if pref == "" {
		pref = "auto"
	}
	if pref == "fnm" || pref == "auto" {
		if p, err := m.find("fnm"); err == nil {
			return Tool{Name: "fnm", Path: p}, nil
		}
	}
	if pref == "mise" || pref == "auto" {
		if p, err := m.find("mise"); err == nil {
			return Tool{Name: "mise", Path: p}, nil
		}
	}
	return Tool{}, fmt.Errorf("no se encontró fnm ni mise; ejecuta `devenv install` o instala uno de ellos")
}

func (m *Manager) find(name string) (string, error) {
	if p, err := m.Runner.LookPath(name); err == nil {
		return p, nil
	}
	p := filepath.Join(m.Paths.BinDir, name)
	if _, err := os.Stat(p); err == nil {
		return p, nil
	}
	return "", errors.New("no encontrado")
}

// Run executes node/npm/npx with the project's resolved Node version.
func (m *Manager) Run(ctx context.Context, tool string, args []string, r project.Resolved, interactive bool) error {
	t, err := m.Detect()
	if err != nil {
		return err
	}
	spec := r.Node
	if spec == "" {
		spec = m.Config.Node.Default
	}
	var name string
	var call []string
	switch t.Name {
	case "fnm":
		name = t.Path
		call = append([]string{"exec", "--using=" + spec, tool}, args...)
	case "mise":
		name = t.Path
		call = append([]string{"exec", "node@" + spec, "--", tool}, args...)
	default:
		return fmt.Errorf("gestor Node no soportado: %s", t.Name)
	}
	if interactive {
		return m.Runner.RunInteractive(ctx, name, call...)
	}
	out, err := m.Runner.Run(ctx, name, call...)
	if out != "" {
		fmt.Fprint(m.UI.Out, out)
	}
	return err
}

// Isolate pins the project to a Node version and installs it if necessary.
func (m *Manager) Isolate(ctx context.Context, version, root string) error {
	version = strings.TrimSpace(version)
	if version == "" {
		return fmt.Errorf("indica una versión de Node")
	}
	t, err := m.Detect()
	if err != nil {
		return err
	}
	ok, err := m.UI.Confirm(fmt.Sprintf("Instalar Node %s si no está disponible (descarga gestionada por %s)", version, t.Name))
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("instalación de Node cancelada")
	}
	var args []string
	switch t.Name {
	case "fnm":
		args = []string{"install", version}
	case "mise":
		args = []string{"install", "node@" + version}
	}
	if out, err := m.Runner.Run(ctx, t.Path, args...); err != nil {
		return fmt.Errorf("instalar Node %s: %w\n%s", version, err, strings.TrimSpace(out))
	}
	name := ".node-version"
	if _, err := os.Stat(filepath.Join(root, ".nvmrc")); err == nil {
		// .nvmrc has higher precedence than .node-version.
		name = ".nvmrc"
	}
	if err := state.WriteFile(filepath.Join(root, name), []byte(version+"\n"), 0o644); err != nil {
		return err
	}
	m.UI.Success("Node %s fijado en %s", version, name)
	return nil
}

func (m *Manager) List(ctx context.Context) (string, error) {
	t, err := m.Detect()
	if err != nil {
		return "", err
	}
	var args []string
	switch t.Name {
	case "fnm":
		args = []string{"list"}
	case "mise":
		args = []string{"ls", "node"}
	}
	return m.Runner.Run(ctx, t.Path, args...)
}
