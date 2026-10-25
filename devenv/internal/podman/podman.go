// Package podman wraps the Podman CLI and registry metadata lookups.
package podman

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"

	"devenv/internal/execx"
	"devenv/internal/ui"
)

type Client struct {
	Runner  execx.Runner
	UI      *ui.UI
	Offline bool
	NoPull  bool
}

func (c *Client) run(ctx context.Context, args ...string) (string, error) {
	return c.Runner.Run(ctx, "podman", args...)
}

// Available verifies that Podman is installed and usable by the current user.
func (c *Client) Available(ctx context.Context) error {
	if _, err := c.Runner.LookPath("podman"); err != nil {
		return fmt.Errorf("podman no está instalado; instálalo con el gestor de paquetes de tu distribución")
	}
	out, err := c.run(ctx, "info", "--format", "{{.Host.Security.Rootless}}")
	if err != nil {
		return fmt.Errorf("podman no está operativo para el usuario actual: %w", err)
	}
	if strings.TrimSpace(out) != "true" {
		return fmt.Errorf("podman está funcionando como root; devenv requiere Podman rootless")
	}
	return nil
}

// NetworkEnsure creates the shared rootless network if needed.
func (c *Client) NetworkEnsure(ctx context.Context) error {
	if _, err := c.run(ctx, "network", "inspect", "devenv"); err == nil {
		return nil
	}
	if _, err := c.run(ctx, "network", "create", "devenv"); err != nil {
		return fmt.Errorf("crear red podman devenv: %w", err)
	}
	return nil
}

func (c *Client) ImageExists(ctx context.Context, image string) bool {
	_, err := c.run(ctx, "image", "exists", image)
	return err == nil
}

func (c *Client) ContainerRunning(ctx context.Context, name string) bool {
	out, err := c.run(ctx, "inspect", "--format", "{{.State.Running}}", name)
	if err != nil {
		return false
	}
	return strings.TrimSpace(out) == "true"
}

// Pull ensures an image exists locally, showing its registry size before a
// download. Existing images are not pulled again unless force is set.
func (c *Client) Pull(ctx context.Context, image string, force bool) error {
	if !force && c.ImageExists(ctx, image) {
		return nil
	}
	if c.Offline {
		return fmt.Errorf("la imagen %s no está local y el modo offline está activo", image)
	}
	if c.NoPull {
		return fmt.Errorf("la imagen %s no está local y se pasó --no-pull", image)
	}
	size, sizeErr := RemoteSize(ctx, image)
	label := ui.HumanSize(size)
	if sizeErr != nil {
		label = "tamaño desconocido"
	}
	ok, err := c.UI.Confirm(fmt.Sprintf("Descargar imagen %s (%s)", image, label))
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("descarga de %s cancelada", image)
	}
	c.UI.Info("Descargando %s...", image)
	if _, err := c.run(ctx, "pull", image); err != nil {
		return fmt.Errorf("descargar %s: %w", image, err)
	}
	return nil
}

func (c *Client) Build(ctx context.Context, tag, dockerfile, contextDir string, buildArgs map[string]string) error {
	args := []string{"build", "-t", tag, "-f", dockerfile}
	for k, v := range buildArgs {
		args = append(args, "--build-arg", k+"="+v)
	}
	args = append(args, contextDir)
	c.UI.Info("Construyendo %s...", tag)
	if _, err := c.run(ctx, args...); err != nil {
		return fmt.Errorf("construir %s: %w", tag, err)
	}
	return nil
}

type ExecOptions struct {
	Interactive bool
	Workdir     string
	Env         []string
}

func (c *Client) Exec(ctx context.Context, container string, interactive bool, args ...string) (string, error) {
	return c.ExecWith(ctx, container, ExecOptions{Interactive: interactive}, args...)
}

func (c *Client) ExecWith(ctx context.Context, container string, opts ExecOptions, args ...string) (string, error) {
	base := []string{"exec"}
	if opts.Interactive {
		base = append(base, "-i")
	}
	if opts.Workdir != "" {
		base = append(base, "-w", opts.Workdir)
	}
	for _, env := range opts.Env {
		base = append(base, "-e", env)
	}
	base = append(base, container)
	base = append(base, args...)
	return c.run(ctx, base...)
}

func (c *Client) ExecSplit(ctx context.Context, container string, opts ExecOptions, args ...string) (string, string, error) {
	base := []string{"exec"}
	if opts.Interactive {
		base = append(base, "-i")
	}
	if opts.Workdir != "" {
		base = append(base, "-w", opts.Workdir)
	}
	for _, env := range opts.Env {
		base = append(base, "-e", env)
	}
	base = append(base, container)
	base = append(base, args...)
	return c.Runner.RunSplit(ctx, "podman", base...)
}

func (c *Client) ExecInput(ctx context.Context, container string, opts ExecOptions, stdin io.Reader, args ...string) (string, error) {
	base := []string{"exec"}
	if opts.Interactive {
		base = append(base, "-i")
	}
	if opts.Workdir != "" {
		base = append(base, "-w", opts.Workdir)
	}
	for _, env := range opts.Env {
		base = append(base, "-e", env)
	}
	base = append(base, container)
	base = append(base, args...)
	return c.Runner.RunInput(ctx, "podman", stdin, base...)
}

func (c *Client) ExecInteractive(ctx context.Context, container string, args ...string) error {
	base := append([]string{"exec", "-it", container}, args...)
	return c.Runner.RunInteractive(ctx, "podman", base...)
}

// ExecAttach connects a command to the terminal. tty controls whether Podman
// allocates a pseudo-terminal; pg_dump must not use one.
func (c *Client) ExecAttach(ctx context.Context, container string, tty bool, opts ExecOptions, args ...string) error {
	base := []string{"exec", "-i"}
	if tty {
		base = append(base, "-t")
	}
	if opts.Workdir != "" {
		base = append(base, "-w", opts.Workdir)
	}
	for _, env := range opts.Env {
		base = append(base, "-e", env)
	}
	base = append(base, container)
	base = append(base, args...)
	return c.Runner.RunInteractive(ctx, "podman", base...)
}

func (c *Client) ImageSize(ctx context.Context, image string) (int64, error) {
	out, err := c.run(ctx, "image", "inspect", "--format", "{{.Size}}", image)
	if err != nil {
		return 0, err
	}
	return strconv.ParseInt(strings.TrimSpace(out), 10, 64)
}

// Health returns the container health status, or its state when no healthcheck
// is configured.
func (c *Client) Health(ctx context.Context, name string) (string, error) {
	out, err := c.run(ctx, "inspect", "--format", "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}", name)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(out), nil
}

func (c *Client) Logs(ctx context.Context, name string, follow bool) error {
	args := []string{"logs"}
	if follow {
		args = append(args, "-f")
	}
	args = append(args, name)
	if follow {
		return c.Runner.RunInteractive(ctx, "podman", args...)
	}
	out, err := c.run(ctx, args...)
	if out != "" {
		fmt.Print(out)
	}
	return err
}

func (c *Client) Remove(ctx context.Context, name string) error {
	_, err := c.run(ctx, "rm", "-f", name)
	return err
}

func IsNotFound(err error) bool {
	return err != nil && (strings.Contains(err.Error(), "no such") || strings.Contains(err.Error(), "not found"))
}

var ErrUnknownSize = errors.New("tamaño remoto desconocido")
