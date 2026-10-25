package config

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"devenv/internal/state"
)

// Config is the global devenv configuration (~/.config/devenv/config.yaml).
type Config struct {
	Version    int                      `yaml:"version"`
	TLD        string                   `yaml:"tld"`
	PHP        PHPConfig                `yaml:"php"`
	Node       NodeConfig               `yaml:"node"`
	Nginx      NginxConfig              `yaml:"nginx"`
	ParkedDirs []string                 `yaml:"parked_dirs"`
	Services   map[string]ServiceConfig `yaml:"services"`
	Offline    bool                     `yaml:"offline"`
}

type PHPConfig struct {
	Default    string   `yaml:"default"`
	Supported  []string `yaml:"supported"`
	Extensions []string `yaml:"extensions"`
	Packages   []string `yaml:"packages"`
}

type NodeConfig struct {
	Manager string `yaml:"manager"`
	Default string `yaml:"default"`
}

type NginxConfig struct {
	HTTPPort  int    `yaml:"http_port"`
	HTTPSPort int    `yaml:"https_port"`
	Image     string `yaml:"image"`
}

type ServiceConfig struct {
	Version string `yaml:"version"`
	Port    int    `yaml:"port"`
}

// Project is the per-project configuration stored in .devenv.yaml.
type Project struct {
	PHPVersion  string            `yaml:"php_version"`
	NodeVersion string            `yaml:"node_version"`
	Domain      string            `yaml:"domain"`
	Secure      *bool             `yaml:"secure"`
	DocRoot     string            `yaml:"docroot"`
	Services    []string          `yaml:"services"`
	Env         map[string]string `yaml:"env"`
}

// Site is one entry in sites.yaml.
type Site struct {
	Name      string    `yaml:"name"`
	Path      string    `yaml:"path"`
	Domain    string    `yaml:"domain"`
	DocRoot   string    `yaml:"docroot"`
	PHP       string    `yaml:"php"`
	Secure    bool      `yaml:"secure"`
	Source    string    `yaml:"source"`
	UpdatedAt time.Time `yaml:"updated_at"`
}

// Sites is the persisted registry.
type Sites struct {
	Version int    `yaml:"version"`
	Sites   []Site `yaml:"sites"`
}

// Secrets stores credentials that must never live in config.yaml.
type Secrets struct {
	Version  int                          `yaml:"version"`
	Services map[string]ServiceSecret     `yaml:"services"`
	Projects map[string]ProjectCredential `yaml:"projects"`
}

type ServiceSecret struct {
	RootPassword string `yaml:"root_password"`
}

type ProjectCredential struct {
	DBUser     string `yaml:"db_user"`
	DBPassword string `yaml:"db_password"`
}

// ServiceState records allocated host ports and the service/version identity.
type ServiceState struct {
	Version  int                        `yaml:"version"`
	Services map[string]ServiceInstance `yaml:"services"`
}

type ServiceInstance struct {
	Name    string         `yaml:"name"`
	Version string         `yaml:"version"`
	Port    int            `yaml:"port"`
	Ports   map[string]int `yaml:"ports,omitempty"`
}

// DefaultConfig returns a complete, opinionated configuration.
func DefaultConfig() Config {
	home, _ := os.UserHomeDir()
	return DefaultConfigForHome(home)
}

// DefaultConfigForHome is DefaultConfig with parked_dirs rooted at home.
func DefaultConfigForHome(home string) Config {
	return Config{
		Version: 1,
		TLD:     "test",
		PHP: PHPConfig{
			Default:    "8.4",
			Supported:  []string{"8.1", "8.2", "8.3", "8.4", "8.5"},
			Extensions: []string{"pdo_mysql", "mbstring", "intl", "zip", "opcache"},
			Packages:   []string{"git", "unzip", "libpng-dev", "libzip-dev", "icu-dev", "oniguruma-dev"},
		},
		Node: NodeConfig{
			Manager: "auto",
			Default: "22",
		},
		Nginx: NginxConfig{
			HTTPPort:  80,
			HTTPSPort: 443,
			Image:     "docker.io/library/nginx:alpine",
		},
		ParkedDirs: []string{filepath.Join(home, "Sites")},
		Services: map[string]ServiceConfig{
			"mysql": {Version: "8.4", Port: 3306},
			"redis": {Version: "7", Port: 6379},
		},
	}
}

// Load reads config.yaml, applying defaults for omitted fields. A missing file
// is not an error: it returns DefaultConfig.
func Load(paths Paths) (Config, error) {
	cfg := DefaultConfigForHome(paths.Home)
	if err := state.ReadYAML(paths.ConfigFile, &cfg); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return cfg, nil
		}
		return Config{}, err
	}
	cfg.applyDefaultsForHome(paths.Home)
	if len(cfg.ParkedDirs) == 0 {
		cfg.ParkedDirs = []string{filepath.Join(paths.Home, "Sites")}
	}
	if err := cfg.Validate(); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func (c *Config) applyDefaults() {
	home, _ := os.UserHomeDir()
	c.applyDefaultsForHome(home)
}

func (c *Config) applyDefaultsForHome(home string) {
	def := DefaultConfigForHome(home)
	if c.Version == 0 {
		c.Version = def.Version
	}
	if c.TLD == "" {
		c.TLD = def.TLD
	}
	if c.PHP.Default == "" {
		c.PHP.Default = def.PHP.Default
	}
	if len(c.PHP.Supported) == 0 {
		c.PHP.Supported = def.PHP.Supported
	}
	if len(c.PHP.Extensions) == 0 {
		c.PHP.Extensions = def.PHP.Extensions
	}
	if len(c.PHP.Packages) == 0 {
		c.PHP.Packages = def.PHP.Packages
	}
	if c.Node.Manager == "" {
		c.Node.Manager = def.Node.Manager
	}
	if c.Node.Default == "" {
		c.Node.Default = def.Node.Default
	}
	if c.Nginx.HTTPPort == 0 {
		c.Nginx.HTTPPort = def.Nginx.HTTPPort
	}
	if c.Nginx.HTTPSPort == 0 {
		c.Nginx.HTTPSPort = def.Nginx.HTTPSPort
	}
	if c.Nginx.Image == "" {
		c.Nginx.Image = def.Nginx.Image
	}
	if c.Services == nil {
		c.Services = def.Services
	}
	for i := range c.ParkedDirs {
		c.ParkedDirs[i] = expandHomeFor(c.ParkedDirs[i], home)
	}
}

func expandHomeFor(path, home string) string {
	if path == "~" {
		return home
	}
	if strings.HasPrefix(path, "~/") {
		return filepath.Join(home, path[2:])
	}
	return path
}

func (c Config) Validate() error {
	if c.Version != 1 {
		return fmt.Errorf("versión de config no soportada: %d", c.Version)
	}
	if strings.TrimSpace(c.TLD) == "" || strings.Contains(c.TLD, ".") {
		return fmt.Errorf("tld inválido: %q", c.TLD)
	}
	if !contains(c.PHP.Supported, c.PHP.Default) {
		return fmt.Errorf("php.default %q no está en php.supported", c.PHP.Default)
	}
	if c.Nginx.HTTPPort < 1 || c.Nginx.HTTPPort > 65535 || c.Nginx.HTTPSPort < 1 || c.Nginx.HTTPSPort > 65535 {
		return fmt.Errorf("puertos de nginx inválidos: %d/%d", c.Nginx.HTTPPort, c.Nginx.HTTPSPort)
	}
	if c.Nginx.HTTPPort == c.Nginx.HTTPSPort {
		return fmt.Errorf("los puertos HTTP y HTTPS deben ser distintos")
	}
	for name, svc := range c.Services {
		if strings.TrimSpace(name) == "" {
			return fmt.Errorf("servicio sin nombre")
		}
		if svc.Port < 0 || svc.Port > 65535 {
			return fmt.Errorf("puerto inválido para %s: %d", name, svc.Port)
		}
	}
	return nil
}

// Save writes the configuration atomically.
func (c Config) Save(paths Paths) error {
	c.applyDefaultsForHome(paths.Home)
	if len(c.ParkedDirs) == 0 {
		c.ParkedDirs = []string{filepath.Join(paths.Home, "Sites")}
	}
	if err := c.Validate(); err != nil {
		return err
	}
	return state.WriteYAML(paths.ConfigFile, c, 0o600)
}

// LoadProject reads .devenv.yaml from root. The bool reports whether the file
// exists.
func LoadProject(root string) (Project, bool, error) {
	var p Project
	path := filepath.Join(root, ".devenv.yaml")
	err := state.ReadYAML(path, &p)
	if errors.Is(err, os.ErrNotExist) {
		return Project{}, false, nil
	}
	if err != nil {
		return Project{}, false, err
	}
	return p, true, nil
}

// LoadSites reads sites.yaml. A missing file yields an empty registry.
func LoadSites(paths Paths) (Sites, error) {
	s := Sites{Version: 1}
	if err := state.ReadYAML(paths.SitesFile, &s); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return s, nil
		}
		return Sites{}, err
	}
	if s.Version == 0 {
		s.Version = 1
	}
	return s, nil
}

func (s Sites) Save(paths Paths) error {
	if s.Version == 0 {
		s.Version = 1
	}
	return state.WriteYAML(paths.SitesFile, s, 0o600)
}

func (s *Sites) Find(name string) (int, bool) {
	for i := range s.Sites {
		if s.Sites[i].Name == name {
			return i, true
		}
	}
	return -1, false
}

func (s *Sites) FindByPath(path string) (int, bool) {
	clean := filepath.Clean(path)
	for i := range s.Sites {
		if filepath.Clean(s.Sites[i].Path) == clean {
			return i, true
		}
	}
	return -1, false
}

func (s *Sites) FindByDomain(domain string) (int, bool) {
	for i := range s.Sites {
		if strings.EqualFold(s.Sites[i].Domain, domain) {
			return i, true
		}
	}
	return -1, false
}

func LoadSecrets(paths Paths) (Secrets, error) {
	s := Secrets{Version: 1, Services: map[string]ServiceSecret{}, Projects: map[string]ProjectCredential{}}
	if err := state.ReadYAML(paths.SecretsFile, &s); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return s, nil
		}
		return Secrets{}, err
	}
	if s.Services == nil {
		s.Services = map[string]ServiceSecret{}
	}
	if s.Projects == nil {
		s.Projects = map[string]ProjectCredential{}
	}
	return s, nil
}

func (s Secrets) Save(paths Paths) error {
	if s.Version == 0 {
		s.Version = 1
	}
	return state.WriteYAML(paths.SecretsFile, s, 0o600)
}

func LoadServiceState(paths Paths) (ServiceState, error) {
	s := ServiceState{Version: 1, Services: map[string]ServiceInstance{}}
	if err := state.ReadYAML(paths.ServicesFile, &s); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return s, nil
		}
		return ServiceState{}, err
	}
	if s.Services == nil {
		s.Services = map[string]ServiceInstance{}
	}
	return s, nil
}

func (s ServiceState) Save(paths Paths) error {
	if s.Version == 0 {
		s.Version = 1
	}
	return state.WriteYAML(paths.ServicesFile, s, 0o600)
}

// ExpandHome expands a leading ~/ or ~ to the current user's home directory.
func ExpandHome(path string) string {
	if path == "~" {
		if home, err := os.UserHomeDir(); err == nil {
			return home
		}
	}
	if strings.HasPrefix(path, "~/") {
		if home, err := os.UserHomeDir(); err == nil {
			return filepath.Join(home, path[2:])
		}
	}
	return path
}

func contains(list []string, value string) bool {
	for _, item := range list {
		if item == value {
			return true
		}
	}
	return false
}
