package cli

import (
	"fmt"

	"github.com/spf13/cobra"
)

func (c *CLI) serviceCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "service",
		Short: "Gestiona MySQL, PostgreSQL, Redis, Meilisearch y Mailpit",
	}
	cmd.AddCommand(
		&cobra.Command{
			Use:   "start <servicio[:version]>",
			Short: "Inicia un servicio (lo instala en el primer uso)",
			Args:  cobra.ExactArgs(1),
			RunE: func(cmd *cobra.Command, args []string) error {
				a, _, err := c.app()
				if err != nil {
					return err
				}
				return a.ServiceStart(cmd.Context(), args[0])
			},
		},
		&cobra.Command{
			Use:   "stop <servicio[:version]>",
			Short: "Detiene un servicio sin borrar sus datos",
			Args:  cobra.ExactArgs(1),
			RunE: func(cmd *cobra.Command, args []string) error {
				a, _, err := c.app()
				if err != nil {
					return err
				}
				return a.ServiceStop(cmd.Context(), args[0])
			},
		},
		&cobra.Command{
			Use:   "restart <servicio[:version]>",
			Short: "Reinicia un servicio",
			Args:  cobra.ExactArgs(1),
			RunE: func(cmd *cobra.Command, args []string) error {
				a, _, err := c.app()
				if err != nil {
					return err
				}
				return a.ServiceRestart(cmd.Context(), args[0])
			},
		},
		&cobra.Command{
			Use:   "status <servicio[:version]>",
			Short: "Muestra el estado de un servicio",
			Args:  cobra.ExactArgs(1),
			RunE: func(cmd *cobra.Command, args []string) error {
				a, u, err := c.app()
				if err != nil {
					return err
				}
				status, err := a.ServiceStatus(cmd.Context(), args[0])
				if err != nil {
					return err
				}
				if u.JSON {
					return u.JSONOut(map[string]string{"status": status})
				}
				fmt.Println(status)
				return nil
			},
		},
		&cobra.Command{
			Use:   "list",
			Short: "Lista servicios instalados",
			RunE: func(cmd *cobra.Command, args []string) error {
				a, u, err := c.app()
				if err != nil {
					return err
				}
				rows, err := a.ServiceList(cmd.Context())
				if err != nil {
					return err
				}
				if u.JSON {
					return u.JSONOut(rows)
				}
				u.Table([]string{"servicio", "versión", "puerto", "activo", "salud"}, rows)
				return nil
			},
		},
	)
	return cmd
}

func (c *CLI) snapshotCmd() *cobra.Command {
	var dbName string
	cmd := &cobra.Command{
		Use:   "db:snapshot [servicio[:version]]",
		Short: "Crea un snapshot SQL comprimido",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			a, _, err := c.app()
			if err != nil {
				return err
			}
			ref := ""
			if len(args) == 1 {
				ref = args[0]
			}
			_, err = a.Snapshot(cmd.Context(), ref, dbName)
			return err
		},
	}
	cmd.Flags().StringVar(&dbName, "db", "", "nombre de la base de datos")
	return cmd
}

func (c *CLI) restoreCmd() *cobra.Command {
	var dbName string
	cmd := &cobra.Command{
		Use:   "db:restore <archivo.sql.gz> [servicio[:version]]",
		Short: "Restaura un snapshot (crea antes un snapshot de seguridad)",
		Args:  cobra.RangeArgs(1, 2),
		RunE: func(cmd *cobra.Command, args []string) error {
			a, _, err := c.app()
			if err != nil {
				return err
			}
			ref := ""
			if len(args) == 2 {
				ref = args[1]
			}
			return a.Restore(cmd.Context(), args[0], ref, dbName)
		},
	}
	cmd.Flags().StringVar(&dbName, "db", "", "nombre de la base de datos")
	return cmd
}

func (c *CLI) secureCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "secure [nombre]",
		Short: "Emite un certificado mkcert y activa HTTPS",
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
			return a.Secure(cmd.Context(), name)
		},
	}
}

func (c *CLI) dnsCheckCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "dns:check",
		Short: "Comprueba la resolución DNS",
		RunE: func(cmd *cobra.Command, args []string) error {
			a, _, err := c.app()
			if err != nil {
				return err
			}
			ok, msg := a.DNSCheck(cmd.Context())
			if ok {
				a.UI.Success("%s", msg)
				return nil
			}
			a.UI.Warn("%s", msg)
			return nil
		},
	}
}

func (c *CLI) dnsEnableCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "dns:enable",
		Short: "Inicia dnsmasq y muestra el comando de NetworkManager",
		RunE: func(cmd *cobra.Command, args []string) error {
			a, _, err := c.app()
			if err != nil {
				return err
			}
			return a.DNSEnable(cmd.Context())
		},
	}
}

func (c *CLI) dnsDisableCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "dns:disable",
		Short: "Detiene dnsmasq",
		RunE: func(cmd *cobra.Command, args []string) error {
			a, _, err := c.app()
			if err != nil {
				return err
			}
			return a.DNSDisable(cmd.Context())
		},
	}
}

func (c *CLI) dnsRepairCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "dns:repair",
		Short: "Regenera la configuración DNS y reinicia dnsmasq",
		RunE: func(cmd *cobra.Command, args []string) error {
			a, _, err := c.app()
			if err != nil {
				return err
			}
			return a.DNSRepair(cmd.Context())
		},
	}
}

func (c *CLI) statusCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "status",
		Short: "Estado de DNS, nginx, PHP, servicios y certificados",
		RunE: func(cmd *cobra.Command, args []string) error {
			a, _, err := c.app()
			if err != nil {
				return err
			}
			return a.Status(cmd.Context())
		},
	}
}

func (c *CLI) doctorCmd() *cobra.Command {
	var fix, dryRun bool
	cmd := &cobra.Command{
		Use:   "doctor",
		Short: "Diagnostica y repara el entorno sin sudo",
		RunE: func(cmd *cobra.Command, args []string) error {
			a, _, err := c.app()
			if err != nil {
				return err
			}
			return a.Doctor(cmd.Context(), fix, dryRun)
		},
	}
	cmd.Flags().BoolVar(&fix, "fix", false, "reparar lo que sea posible")
	cmd.Flags().BoolVar(&dryRun, "dry-run", false, "mostrar acciones sin ejecutarlas")
	return cmd
}

func (c *CLI) logsCmd() *cobra.Command {
	var follow bool
	cmd := &cobra.Command{
		Use:   "logs [target]",
		Short: "Muestra logs de nginx, PHP, un servicio o el watcher",
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
			return a.Logs(cmd.Context(), target, follow)
		},
	}
	cmd.Flags().BoolVarP(&follow, "follow", "f", false, "seguir los logs")
	return cmd
}

func (c *CLI) watchCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "watch",
		Short: "Vigila los directorios parked y registra proyectos nuevos",
		RunE: func(cmd *cobra.Command, args []string) error {
			a, _, err := c.app()
			if err != nil {
				return err
			}
			return a.Watch(cmd.Context())
		},
	}
}

func (c *CLI) shimsCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "shims:install",
		Short: "Instala los shims mysql, psql y pg_dump",
		RunE: func(cmd *cobra.Command, args []string) error {
			a, _, err := c.app()
			if err != nil {
				return err
			}
			return a.InstallShims()
		},
	}
}

func (c *CLI) shimCmd() *cobra.Command {
	return &cobra.Command{
		Use:                "shim <tool> [args...]",
		Short:              "Entrada interna de los shims",
		Hidden:             true,
		DisableFlagParsing: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			if len(args) == 0 {
				return fmt.Errorf("falta la herramienta")
			}
			a, _, err := c.app()
			if err != nil {
				return err
			}
			return a.DB.Shim(cmd.Context(), args[0], args[1:])
		},
	}
}
