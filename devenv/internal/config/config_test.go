package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadDefaultsAndRoundTrip(t *testing.T) {
	home := t.TempDir()
	paths := PathsFromHome(home)
	if err := paths.Ensure(); err != nil {
		t.Fatal(err)
	}
	cfg, err := Load(paths)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.PHP.Default != "8.4" || cfg.TLD != "test" {
		t.Fatalf("unexpected defaults: %+v", cfg)
	}
	if len(cfg.ParkedDirs) != 1 || cfg.ParkedDirs[0] != filepath.Join(home, "Sites") {
		t.Fatalf("parked dirs = %v", cfg.ParkedDirs)
	}
	cfg.TLD = "localhost"
	if err := cfg.Save(paths); err != nil {
		t.Fatal(err)
	}
	loaded, err := Load(paths)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.TLD != "localhost" {
		t.Fatalf("TLD = %q", loaded.TLD)
	}
	if _, err := os.Stat(paths.ConfigFile); err != nil {
		t.Fatal(err)
	}
}

func TestLoadExpandsHomeRelativeParkedDirs(t *testing.T) {
	home := t.TempDir()
	paths := PathsFromHome(home)
	if err := paths.Ensure(); err != nil {
		t.Fatal(err)
	}
	cfg := DefaultConfigForHome(home)
	cfg.ParkedDirs = []string{"~/Projects"}
	if err := cfg.Save(paths); err != nil {
		t.Fatal(err)
	}
	loaded, err := Load(paths)
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(home, "Projects")
	if len(loaded.ParkedDirs) != 1 || loaded.ParkedDirs[0] != want {
		t.Fatalf("parked dirs = %v, want %s", loaded.ParkedDirs, want)
	}
}

func TestConfigValidation(t *testing.T) {
	cfg := DefaultConfigForHome("/home/x")
	cfg.PHP.Default = "9.0"
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected invalid PHP default")
	}
	cfg = DefaultConfigForHome("/home/x")
	cfg.Nginx.HTTPPort = 0
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected invalid nginx port")
	}
}

func TestSitesAndServiceState(t *testing.T) {
	paths := PathsFromHome(t.TempDir())
	if err := paths.Ensure(); err != nil {
		t.Fatal(err)
	}
	sites := Sites{Version: 1, Sites: []Site{{Name: "foo", Path: "/tmp/foo", Domain: "foo.test"}}}
	if err := sites.Save(paths); err != nil {
		t.Fatal(err)
	}
	loaded, err := LoadSites(paths)
	if err != nil {
		t.Fatal(err)
	}
	if idx, ok := loaded.Find("foo"); !ok || idx != 0 {
		t.Fatal("site not found")
	}
	if _, ok := loaded.FindByDomain("foo.test"); !ok {
		t.Fatal("domain not found")
	}

	state := ServiceState{Version: 1, Services: map[string]ServiceInstance{
		"mysql:8.4": {Name: "mysql", Version: "8.4", Port: 3307, Ports: map[string]int{"mysql": 3307}},
	}}
	if err := state.Save(paths); err != nil {
		t.Fatal(err)
	}
	got, err := LoadServiceState(paths)
	if err != nil {
		t.Fatal(err)
	}
	if got.Services["mysql:8.4"].Ports["mysql"] != 3307 {
		t.Fatalf("state = %+v", got)
	}
}
