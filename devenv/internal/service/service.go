// Package service defines the supported backing services and manages their
// Quadlet units.
package service

import (
	"context"
	"crypto/rand"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"time"

	"devenv/internal/config"
	"devenv/internal/podman"
	"devenv/internal/quadlet"
	"devenv/internal/systemd"
	"devenv/internal/ui"
)

type PortSpec struct {
	Name      string
	Default   int
	Container int
	Protocol  string
}

type Definition struct {
	Name           string
	Image          string // contains <version>
	DefaultVersion string
	Versions       []string
	Ports          []PortSpec
	DataPath       string
	NetworkAlias   string
	Exec           string
	Client         string
	DBKind         string // mysql | postgres | ""
	Env            func(root string, ports map[string]int) []string
	HealthCmd      func(root string) string
}

var catalog = map[string]Definition{
	"mysql": {
		Name: "mysql", Image: "docker.io/library/mysql:<version>", DefaultVersion: "8.4",
		Versions: []string{"5.7", "8.0", "8.4"},
		Ports:    []PortSpec{{Name: "mysql", Default: 3306, Container: 3306, Protocol: "tcp"}},
		DataPath: "/var/lib/mysql", NetworkAlias: "devenv-mysql", Client: "mysql", DBKind: "mysql",
		Env: func(root string, _ map[string]int) []string {
			return []string{"MYSQL_ROOT_PASSWORD=" + root}
		},
		HealthCmd: func(root string) string {
			return "mysqladmin ping -h 127.0.0.1 -u root -p" + root
		},
	},
	"postgres": {
		Name: "postgres", Image: "docker.io/library/postgres:<version>", DefaultVersion: "16",
		Versions: []string{"13", "14", "15", "16", "17"},
		Ports:    []PortSpec{{Name: "postgres", Default: 5432, Container: 5432, Protocol: "tcp"}},
		DataPath: "/var/lib/postgresql/data", NetworkAlias: "devenv-postgres", Client: "psql", DBKind: "postgres",
		Env: func(root string, _ map[string]int) []string {
			return []string{"POSTGRES_PASSWORD=" + root, "POSTGRES_USER=postgres", "POSTGRES_DB=postgres"}
		},
		HealthCmd: func(string) string { return "pg_isready -U postgres" },
	},
	"redis": {
		Name: "redis", Image: "docker.io/library/redis:<version>", DefaultVersion: "7",
		Versions: []string{"6", "7"},
		Ports:    []PortSpec{{Name: "redis", Default: 6379, Container: 6379, Protocol: "tcp"}},
		DataPath: "/data", NetworkAlias: "devenv-redis", Client: "redis-cli",
		Exec:      "redis-server --appendonly yes",
		Env:       func(string, map[string]int) []string { return nil },
		HealthCmd: func(string) string { return "redis-cli ping" },
	},
	"meilisearch": {
		Name: "meilisearch", Image: "docker.io/getmeili/meilisearch:<version>", DefaultVersion: "v1.8",
		Versions: []string{"v1.8", "v1.9", "v1.10"},
		Ports:    []PortSpec{{Name: "http", Default: 7700, Container: 7700, Protocol: "tcp"}},
		DataPath: "/meili_data", NetworkAlias: "devenv-meilisearch", Client: "meilisearch",
		Env: func(root string, _ map[string]int) []string {
			return []string{"MEILI_MASTER_KEY=" + root, "MEILI_NO_ANALYTICS=true", "MEILI_ENV=development"}
		},
	},
	"mailpit": {
		Name: "mailpit", Image: "docker.io/axllent/mailpit:<version>", DefaultVersion: "v1.21",
		Versions: []string{"v1.20", "v1.21", "v1.22"},
		Ports: []PortSpec{
			{Name: "smtp", Default: 1025, Container: 1025, Protocol: "tcp"},
			{Name: "http", Default: 8025, Container: 8025, Protocol: "tcp"},
		},
		DataPath: "/data", NetworkAlias: "devenv-mailpit", Client: "mailpit",
		Env: func(string, map[string]int) []string {
			return []string{"MP_DATA_FILE=/data/mailpit.db"}
		},
	},
}

type Manager struct {
	Paths   config.Paths
	Config  config.Config
	Podman  *podman.Client
	Systemd *systemd.Manager
	Quadlet *quadlet.Manager
	UI      *ui.UI
}

func Lookup(name string) (Definition, bool) {
	d, ok := catalog[name]
	return d, ok
}

func Names() []string {
	return []string{"mysql", "postgres", "redis", "meilisearch", "mailpit"}
}

func ParseRef(ref string, cfg config.Config) (Definition, string, error) {
	ref = strings.TrimSpace(ref)
	name := ref
	version := ""
	if i := strings.IndexByte(ref, ':'); i >= 0 {
		name = ref[:i]
		version = ref[i+1:]
	}
	def, ok := catalog[name]
	if !ok {
		return Definition{}, "", fmt.Errorf("servicio desconocido %q (disponibles: %s)", name, strings.Join(Names(), ", "))
	}
	if version == "" {
		if sc, ok := cfg.Services[name]; ok && sc.Version != "" {
			version = sc.Version
		} else {
			version = def.DefaultVersion
		}
	}
	if !contains(def.Versions, version) {
		return Definition{}, "", fmt.Errorf("versión %s no soportada para %s (disponibles: %s)", version, name, strings.Join(def.Versions, ", "))
	}
	return def, version, nil
}

func Key(name, version string) string {
	return name + ":" + version
}

func ContainerName(name, version string) string {
	return "devenv-" + name + "-" + version
}

func UnitName(name, version string) string {
	return ContainerName(name, version) + ".service"
}

func (m *Manager) defaultVersion(def Definition) string {
	if sc, ok := m.Config.Services[def.Name]; ok && sc.Version != "" {
		return sc.Version
	}
	return def.DefaultVersion
}

// DefaultVersion is the version new projects use for a service.
func (m *Manager) DefaultVersion(def Definition) string {
	return m.defaultVersion(def)
}

// Start installs (if needed), starts and health-checks a service.
func (m *Manager) Start(ctx context.Context, ref string, force bool) (config.ServiceInstance, config.ServiceSecret, error) {
	def, version, err := ParseRef(ref, m.Config)
	if err != nil {
		return config.ServiceInstance{}, config.ServiceSecret{}, err
	}
	if err := m.Podman.NetworkEnsure(ctx); err != nil {
		return config.ServiceInstance{}, config.ServiceSecret{}, err
	}
	image := strings.ReplaceAll(def.Image, "<version>", version)
	if err := m.Podman.Pull(ctx, image, force); err != nil {
		return config.ServiceInstance{}, config.ServiceSecret{}, err
	}

	secrets, err := config.LoadSecrets(m.Paths)
	if err != nil {
		return config.ServiceInstance{}, config.ServiceSecret{}, err
	}
	key := def.Name + "-" + version
	sec := secrets.Services[key]
	if sec.RootPassword == "" {
		sec.RootPassword = randomPassword(28)
		secrets.Services[key] = sec
	}

	state, err := config.LoadServiceState(m.Paths)
	if err != nil {
		return config.ServiceInstance{}, config.ServiceSecret{}, err
	}
	inst, ok := state.Services[Key(def.Name, version)]
	validPorts := ok && len(inst.Ports) == len(def.Ports)
	if validPorts {
		for _, p := range def.Ports {
			if inst.Ports[p.Name] <= 0 {
				validPorts = false
				break
			}
		}
	}
	if !validPorts {
		inst = config.ServiceInstance{Name: def.Name, Version: version, Ports: map[string]int{}}
		for i, p := range def.Ports {
			preferred := p.Default
			if i == 0 {
				if sc, ok := m.Config.Services[def.Name]; ok && sc.Port > 0 {
					preferred = sc.Port
				}
			}
			port, err := allocatePort(preferred)
			if err != nil {
				return config.ServiceInstance{}, config.ServiceSecret{}, err
			}
			inst.Ports[p.Name] = port
			if i == 0 {
				inst.Port = port
			}
		}
	}
	if inst.Port == 0 && len(def.Ports) > 0 {
		inst.Port = inst.Ports[def.Ports[0].Name]
	}

	dataDir := filepath.Join(m.Paths.DataDir, def.Name+"-"+version)
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return config.ServiceInstance{}, config.ServiceSecret{}, fmt.Errorf("crear datos de %s:%s: %w", def.Name, version, err)
	}
	volumes := []string{dataDir + ":" + def.DataPath + ":Z"}
	env := def.Env(sec.RootPassword, inst.Ports)
	var publish []string
	for _, p := range def.Ports {
		proto := p.Protocol
		if proto == "" {
			proto = "tcp"
		}
		publish = append(publish, fmt.Sprintf("127.0.0.1:%d:%d/%s", inst.Ports[p.Name], p.Container, proto))
	}
	alias := ""
	if version == m.defaultVersion(def) {
		alias = def.NetworkAlias
	}
	health := ""
	if def.HealthCmd != nil {
		health = def.HealthCmd(sec.RootPassword)
	}
	unit, err := m.Quadlet.InstallService(quadlet.ServiceData{
		Name: def.Name, Version: version, ContainerName: ContainerName(def.Name, version),
		Image: image, NetworkAlias: alias, Volumes: volumes, Env: env,
		PublishPorts: publish, HealthCmd: health, Exec: def.Exec,
	})
	if err != nil {
		return config.ServiceInstance{}, config.ServiceSecret{}, err
	}
	if err := m.Quadlet.Reload(ctx); err != nil {
		return config.ServiceInstance{}, config.ServiceSecret{}, err
	}
	if err := m.Systemd.Restart(ctx, unit); err != nil {
		return config.ServiceInstance{}, config.ServiceSecret{}, err
	}
	if err := m.waitHealthy(ctx, ContainerName(def.Name, version)); err != nil {
		return config.ServiceInstance{}, config.ServiceSecret{}, err
	}

	state.Services[Key(def.Name, version)] = inst
	if err := state.Save(m.Paths); err != nil {
		return config.ServiceInstance{}, config.ServiceSecret{}, err
	}
	if err := secrets.Save(m.Paths); err != nil {
		return config.ServiceInstance{}, config.ServiceSecret{}, err
	}
	return inst, sec, nil
}

func (m *Manager) waitHealthy(ctx context.Context, container string) error {
	deadline := time.Now().Add(90 * time.Second)
	for time.Now().Before(deadline) {
		status, err := m.Podman.Health(ctx, container)
		if err == nil {
			switch strings.ToLower(status) {
			case "healthy", "running":
				return nil
			case "unhealthy", "exited", "dead":
				return fmt.Errorf("el contenedor %s está %s; revisa `devenv logs %s`", container, status, container)
			}
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(500 * time.Millisecond):
		}
	}
	return fmt.Errorf("el servicio %s no quedó saludable a tiempo; revisa `devenv logs %s`", container, container)
}

func (m *Manager) Stop(ctx context.Context, ref string) error {
	def, version, err := ParseRef(ref, m.Config)
	if err != nil {
		return err
	}
	return m.Systemd.Stop(ctx, UnitName(def.Name, version))
}

func (m *Manager) Restart(ctx context.Context, ref string) error {
	def, version, err := ParseRef(ref, m.Config)
	if err != nil {
		return err
	}
	return m.Systemd.Restart(ctx, UnitName(def.Name, version))
}

func (m *Manager) Status(ctx context.Context, ref string) (string, error) {
	def, version, err := ParseRef(ref, m.Config)
	if err != nil {
		return "", err
	}
	unit := UnitName(def.Name, version)
	container := ContainerName(def.Name, version)
	active := "inactivo"
	if m.Systemd.IsActive(ctx, unit) {
		active = "activo"
	}
	health, _ := m.Podman.Health(ctx, container)
	if health == "" {
		health = "sin contenedor"
	}
	return fmt.Sprintf("%s:%s\t%s\t%s", def.Name, version, active, health), nil
}

func (m *Manager) List(ctx context.Context) ([][]string, error) {
	state, err := config.LoadServiceState(m.Paths)
	if err != nil {
		return nil, err
	}
	var rows [][]string
	for _, name := range Names() {
		def := catalog[name]
		for _, version := range def.Versions {
			key := Key(name, version)
			inst, ok := state.Services[key]
			if !ok {
				continue
			}
			active := "no"
			if m.Systemd.IsActive(ctx, UnitName(name, version)) {
				active = "sí"
			}
			health, _ := m.Podman.Health(ctx, ContainerName(name, version))
			rows = append(rows, []string{name, version, fmt.Sprint(inst.Port), active, health})
		}
	}
	return rows, nil
}

func randomPassword(n int) string {
	const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return "devenv-change-me"
	}
	for i := range buf {
		buf[i] = alphabet[int(buf[i])%len(alphabet)]
	}
	return string(buf)
}

func allocatePort(preferred int) (int, error) {
	for port := preferred; port < preferred+200 && port <= 65535; port++ {
		ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
		if err == nil {
			ln.Close()
			return port, nil
		}
	}
	return 0, fmt.Errorf("no se encontró un puerto libre desde %d", preferred)
}

func contains(list []string, v string) bool {
	for _, item := range list {
		if item == v {
			return true
		}
	}
	return false
}
