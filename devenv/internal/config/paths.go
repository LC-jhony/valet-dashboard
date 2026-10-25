package config

import (
	"fmt"
	"os"
	"path/filepath"
)

// Paths contains every filesystem location used by devenv. All paths are
// derived from the user's home so tests can use a temporary directory.
type Paths struct {
	Home string

	ConfigDir  string
	ConfigFile string
	StateDir   string
	LockFile   string

	SitesFile    string
	SecretsFile  string
	ServicesFile string

	BinDir       string
	NginxDir     string
	NginxConf    string
	NginxConfD   string
	NginxLogs    string
	CertsDir     string
	CACertsDir   string
	SiteCertsDir string
	DataDir      string
	DNSDir       string
	SnapshotsDir string
	BackupsDir   string
	BuildDir     string

	QuadletDir     string
	SystemdUserDir string
}

// PathsFromHome builds the layout under a specific home directory. It does not
// read XDG variables, which keeps tests hermetic.
func PathsFromHome(home string) Paths {
	configDir := filepath.Join(home, ".config", "devenv")
	stateDir := filepath.Join(home, ".local", "share", "devenv")
	return Paths{
		Home:           home,
		ConfigDir:      configDir,
		ConfigFile:     filepath.Join(configDir, "config.yaml"),
		StateDir:       stateDir,
		LockFile:       filepath.Join(stateDir, "devenv.lock"),
		SitesFile:      filepath.Join(stateDir, "sites.yaml"),
		SecretsFile:    filepath.Join(stateDir, "secrets.yaml"),
		ServicesFile:   filepath.Join(stateDir, "services.yaml"),
		BinDir:         filepath.Join(stateDir, "bin"),
		NginxDir:       filepath.Join(stateDir, "nginx"),
		NginxConf:      filepath.Join(stateDir, "nginx", "nginx.conf"),
		NginxConfD:     filepath.Join(stateDir, "nginx", "conf.d"),
		NginxLogs:      filepath.Join(stateDir, "nginx", "logs"),
		CertsDir:       filepath.Join(stateDir, "certs"),
		CACertsDir:     filepath.Join(stateDir, "certs", "ca"),
		SiteCertsDir:   filepath.Join(stateDir, "certs", "sites"),
		DataDir:        filepath.Join(stateDir, "data"),
		DNSDir:         filepath.Join(stateDir, "dnsmasq"),
		SnapshotsDir:   filepath.Join(stateDir, "snapshots"),
		BackupsDir:     filepath.Join(stateDir, "backups"),
		BuildDir:       filepath.Join(stateDir, "build"),
		QuadletDir:     filepath.Join(home, ".config", "containers", "systemd"),
		SystemdUserDir: filepath.Join(home, ".config", "systemd", "user"),
	}
}

// DefaultPaths respects DEVENV_HOME and the XDG base directory variables.
func DefaultPaths() (Paths, error) {
	if home := os.Getenv("DEVENV_HOME"); home != "" {
		return PathsFromHome(home), nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return Paths{}, fmt.Errorf("obtener HOME: %w", err)
	}
	p := PathsFromHome(home)
	if xdg := os.Getenv("XDG_CONFIG_HOME"); xdg != "" {
		p.ConfigDir = filepath.Join(xdg, "devenv")
		p.ConfigFile = filepath.Join(p.ConfigDir, "config.yaml")
		p.QuadletDir = filepath.Join(xdg, "containers", "systemd")
		p.SystemdUserDir = filepath.Join(xdg, "systemd", "user")
	}
	if xdg := os.Getenv("XDG_DATA_HOME"); xdg != "" {
		p.StateDir = filepath.Join(xdg, "devenv")
		p.LockFile = filepath.Join(p.StateDir, "devenv.lock")
		p.SitesFile = filepath.Join(p.StateDir, "sites.yaml")
		p.SecretsFile = filepath.Join(p.StateDir, "secrets.yaml")
		p.ServicesFile = filepath.Join(p.StateDir, "services.yaml")
		p.BinDir = filepath.Join(p.StateDir, "bin")
		p.NginxDir = filepath.Join(p.StateDir, "nginx")
		p.NginxConf = filepath.Join(p.NginxDir, "nginx.conf")
		p.NginxConfD = filepath.Join(p.NginxDir, "conf.d")
		p.NginxLogs = filepath.Join(p.NginxDir, "logs")
		p.CertsDir = filepath.Join(p.StateDir, "certs")
		p.CACertsDir = filepath.Join(p.CertsDir, "ca")
		p.SiteCertsDir = filepath.Join(p.CertsDir, "sites")
		p.DataDir = filepath.Join(p.StateDir, "data")
		p.DNSDir = filepath.Join(p.StateDir, "dnsmasq")
		p.SnapshotsDir = filepath.Join(p.StateDir, "snapshots")
		p.BackupsDir = filepath.Join(p.StateDir, "backups")
		p.BuildDir = filepath.Join(p.StateDir, "build")
	}
	return p, nil
}

// Ensure creates the directories that must exist before any command runs.
func (p Paths) Ensure() error {
	dirs := []struct {
		path string
		mode os.FileMode
	}{
		{p.ConfigDir, 0o700},
		{p.StateDir, 0o700},
		{p.BinDir, 0o755},
		{p.NginxDir, 0o755},
		{p.NginxConfD, 0o755},
		{p.NginxLogs, 0o755},
		{p.CertsDir, 0o700},
		{p.CACertsDir, 0o700},
		{p.SiteCertsDir, 0o700},
		{p.DataDir, 0o700},
		{p.DNSDir, 0o755},
		{p.SnapshotsDir, 0o700},
		{p.BackupsDir, 0o700},
		{p.BuildDir, 0o755},
		{p.QuadletDir, 0o755},
		{p.SystemdUserDir, 0o755},
	}
	for _, d := range dirs {
		if err := os.MkdirAll(d.path, d.mode); err != nil {
			return fmt.Errorf("crear %s: %w", d.path, err)
		}
	}
	return nil
}
