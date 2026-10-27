// Package cli wires the Cobra commands to the application use cases.
package cli

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/spf13/cobra"

	"devenv/internal/app"
	"devenv/internal/config"
	"devenv/internal/execx"
	"devenv/internal/ui"
)

const Version = "0.1.0"

type CLI struct {
	Yes     bool
	Offline bool
	NoPull  bool
	Verbose bool
	JSON    bool
	NoColor bool
}

func NewRoot() *cobra.Command {
	c := &CLI{}
	root := &cobra.Command{
		Use:           "devenv",
		Short:         "Entornos PHP locales aislados con Podman rootless",
		Long:          "devenv gestiona PHP multiversión, nginx, dominios .test, HTTPS y servicios de datos en contenedores Podman rootless.",
		SilenceErrors: true,
		SilenceUsage:  true,
	}
	root.PersistentFlags().BoolVarP(&c.Yes, "yes", "y", false, "no preguntar; aceptar descargas y acciones")
	root.PersistentFlags().BoolVar(&c.Offline, "offline", false, "no descargar nada; usar solo recursos locales")
	root.PersistentFlags().BoolVar(&c.NoPull, "no-pull", false, "no descargar imágenes; fallar si faltan")
	root.PersistentFlags().BoolVarP(&c.Verbose, "verbose", "v", false, "mostrar comandos ejecutados")
	root.PersistentFlags().BoolVar(&c.JSON, "json", false, "salida JSON cuando aplique")
	root.PersistentFlags().BoolVar(&c.NoColor, "no-color", false, "desactivar colores")

	root.AddCommand(
		c.installCmd(),
		c.linkCmd(),
		c.unlinkCmd(),
		c.parkCmd(),
		c.unparkCmd(),
		c.sitesCmd(),
		c.useCmd(),
		c.isolateCmd(),
		c.phpListCmd(),
		c.phpRebuildCmd(),
		c.phpCmd(),
		c.composerCmd(),
		c.nodeCmd("node", "node"),
		c.nodeCmd("npm", "npm"),
		c.nodeCmd("npx", "npx"),
		c.isolateNodeCmd(),
		c.serviceCmd(),
		c.mailCmd(),
		c.snapshotCmd(),
		c.restoreCmd(),
		c.secureCmd(),
		c.dnsCheckCmd(),
		c.dnsEnableCmd(),
		c.dnsDisableCmd(),
		c.dnsRepairCmd(),
		c.statusCmd(),
		c.doctorCmd(),
		c.logsCmd(),
		c.watchCmd(),
		c.shimsCmd(),
		c.shimCmd(),
		c.versionCmd(),
	)
	return root
}

func (c *CLI) app() (*app.App, *ui.UI, error) {
	paths, err := config.DefaultPaths()
	if err != nil {
		return nil, nil, err
	}
	u := ui.New(os.Stdout, os.Stderr)
	u.Yes = c.Yes
	u.JSON = c.JSON
	u.NoColor = u.NoColor || c.NoColor
	runner := &execx.OSRunner{Verbose: c.Verbose, Out: os.Stdout, Err: os.Stderr}
	a, err := app.New(paths, u, runner, c.Offline, c.NoPull)
	if err != nil {
		return nil, nil, err
	}
	return a, u, nil
}

func (c *CLI) installCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "install",
		Short: "Inicializa directorios, red Podman, nginx y herramientas",
		RunE: func(cmd *cobra.Command, args []string) error {
			a, _, err := c.app()
			if err != nil {
				return err
			}
			return a.Install(cmd.Context())
		},
	}
}

func (c *CLI) linkCmd() *cobra.Command {
	var domain string
	cmd := &cobra.Command{
		Use:   "link [nombre]",
		Short: "Registra el proyecto actual y genera su vhost",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			a, _, err := c.app()
			if err != nil {
				return err
			}
			name := ""
			if len(args) == 1 {
				name = args[0]
			}
			site, err := a.Link(cmd.Context(), ".", app.LinkOptions{Name: name, Domain: domain})
			if err != nil {
				return err
			}
			_ = site
			return nil
		},
	}
	cmd.Flags().StringVar(&domain, "domain", "", "dominio explícito (ej. foo.test)")
	return cmd
}

func (c *CLI) unlinkCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "unlink [nombre]",
		Short: "Elimina un sitio registrado",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			a, _, err := c.app()
			if err != nil {
				return err
			}
			target := ""
			if len(args) == 1 {
				target = args[0]
			}
			return a.Unlink(cmd.Context(), target)
		},
	}
}

func (c *CLI) parkCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "park <directorio>",
		Short: "Registra todos los proyectos de un directorio y activa el watcher",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			a, _, err := c.app()
			if err != nil {
				return err
			}
			return a.Park(cmd.Context(), args[0])
		},
	}
}

func (c *CLI) unparkCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "unpark <directorio>",
		Short: "Quita un directorio parked y sus sitios",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			a, _, err := c.app()
			if err != nil {
				return err
			}
			return a.Unpark(cmd.Context(), args[0])
		},
	}
}

func (c *CLI) sitesCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "sites",
		Short: "Lista los sitios registrados",
		RunE: func(cmd *cobra.Command, args []string) error {
			a, u, err := c.app()
			if err != nil {
				return err
			}
			sites, err := a.Sites()
			if err != nil {
				return err
			}
			if u.JSON {
				return u.JSONOut(sites)
			}
			rows := make([][]string, 0, len(sites))
			for _, s := range sites {
				scheme := "http"
				if s.Secure {
					scheme = "https"
				}
				rows = append(rows, []string{s.Name, s.Domain, s.PHP, s.DocRoot, scheme, s.Path})
			}
			u.Table([]string{"nombre", "dominio", "PHP", "docroot", "esquema", "ruta"}, rows)
			return nil
		},
	}
}

func (c *CLI) useCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "use <version>",
		Short: "Cambia la versión PHP global",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			a, _, err := c.app()
			if err != nil {
				return err
			}
			return a.UsePHP(cmd.Context(), args[0])
		},
	}
}

func (c *CLI) isolateCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "isolate <version>",
		Short: "Fija la versión PHP del proyecto en .php-version",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			a, _, err := c.app()
			if err != nil {
				return err
			}
			return a.IsolatePHP(cmd.Context(), args[0])
		},
	}
}

func (c *CLI) phpListCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "php:list",
		Short: "Lista versiones PHP, imágenes y contenedores",
		RunE: func(cmd *cobra.Command, args []string) error {
			a, _, err := c.app()
			if err != nil {
				return err
			}
			return a.PHPList(cmd.Context())
		},
	}
}

func (c *CLI) phpRebuildCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "php:rebuild [version]",
		Short: "Reconstruye una imagen PHP",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			a, _, err := c.app()
			if err != nil {
				return err
			}
			v := a.Config.PHP.Default
			if len(args) == 1 {
				v = args[0]
			}
			return a.PHPRebuild(cmd.Context(), v)
		},
	}
}

func (c *CLI) phpCmd() *cobra.Command {
	return &cobra.Command{
		Use:                "php [args...]",
		Short:              "Ejecuta PHP dentro del contenedor del proyecto",
		DisableFlagParsing: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			a, _, err := c.app()
			if err != nil {
				return err
			}
			return a.PHPExec(cmd.Context(), args)
		},
	}
}

func (c *CLI) composerCmd() *cobra.Command {
	return &cobra.Command{
		Use:                "composer [args...]",
		Short:              "Ejecuta Composer dentro del contenedor PHP del proyecto",
		DisableFlagParsing: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			a, _, err := c.app()
			if err != nil {
				return err
			}
			return a.ComposerExec(cmd.Context(), args)
		},
	}
}

func (c *CLI) nodeCmd(name, tool string) *cobra.Command {
	return &cobra.Command{
		Use:                name + " [args...]",
		Short:              "Ejecuta " + tool + " con la versión Node del proyecto",
		DisableFlagParsing: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			a, _, err := c.app()
			if err != nil {
				return err
			}
			return a.NodeExec(cmd.Context(), tool, args)
		},
	}
}

func (c *CLI) isolateNodeCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "isolate:node <version>",
		Short: "Fija la versión Node del proyecto",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			a, _, err := c.app()
			if err != nil {
				return err
			}
			return a.IsolateNode(cmd.Context(), args[0])
		},
	}
}

func (c *CLI) versionCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "version",
		Short: "Muestra la versión de devenv",
		Run: func(cmd *cobra.Command, args []string) {
			fmt.Println("devenv " + Version)
		},
	}
}

func Execute() int {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	root := NewRoot()
	root.SetContext(ctx)
	if err := root.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, "Error:", err)
		return 1
	}
	return 0
}
