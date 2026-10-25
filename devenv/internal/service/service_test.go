package service

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"devenv/internal/config"
	"devenv/internal/execx"
	"devenv/internal/podman"
	"devenv/internal/quadlet"
	"devenv/internal/systemd"
	"devenv/internal/ui"
)

func TestParseRef(t *testing.T) {
	cfg := config.DefaultConfigForHome("/home/test")
	cases := []struct {
		ref     string
		name    string
		version string
	}{
		{"mysql", "mysql", "8.4"},
		{"mysql:8.0", "mysql", "8.0"},
		{"postgres:17", "postgres", "17"},
		{"redis:6", "redis", "6"},
		{"meilisearch:v1.9", "meilisearch", "v1.9"},
		{"mailpit:v1.22", "mailpit", "v1.22"},
	}
	for _, tc := range cases {
		def, version, err := ParseRef(tc.ref, cfg)
		if err != nil {
			t.Fatalf("ParseRef(%q): %v", tc.ref, err)
		}
		if def.Name != tc.name || version != tc.version {
			t.Fatalf("ParseRef(%q) = %s:%s, want %s:%s", tc.ref, def.Name, version, tc.name, tc.version)
		}
	}
	for _, bad := range []string{"mongo", "mysql:9.0", "redis:latest", ""} {
		if _, _, err := ParseRef(bad, cfg); err == nil {
			t.Errorf("ParseRef(%q) should fail", bad)
		}
	}
}

func TestStartCreatesSafeDataPathAndUnit(t *testing.T) {
	home := t.TempDir()
	paths := config.PathsFromHome(home)
	if err := paths.Ensure(); err != nil {
		t.Fatal(err)
	}
	cfg := config.DefaultConfigForHome(home)
	u := ui.New(io.Discard, io.Discard)
	runner := &execx.FakeRunner{
		RunFunc: func(ctx context.Context, name string, args ...string) (string, error) {
			joined := strings.Join(args, " ")
			switch {
			case strings.HasPrefix(joined, "network inspect"), strings.HasPrefix(joined, "network create"):
				return "", nil
			case strings.HasPrefix(joined, "image exists"):
				return "", nil
			case strings.HasPrefix(joined, "pull "):
				return "", nil
			case strings.HasPrefix(joined, "inspect "):
				return "healthy\n", nil
			default:
				return "", nil
			}
		},
	}
	systemdManager := &systemd.Manager{Runner: runner}
	m := &Manager{
		Paths:   paths,
		Config:  cfg,
		Podman:  &podman.Client{Runner: runner, UI: u},
		Systemd: systemdManager,
		Quadlet: &quadlet.Manager{Paths: paths, Systemd: systemdManager},
		UI:      u,
	}
	inst, sec, err := m.Start(context.Background(), "mysql:8.4", false)
	if err != nil {
		t.Fatal(err)
	}
	if inst.Ports["mysql"] <= 0 || inst.Port != inst.Ports["mysql"] {
		t.Fatalf("invalid ports: %+v", inst)
	}
	if sec.RootPassword == "" {
		t.Fatal("missing root password")
	}
	unitPath := filepath.Join(paths.QuadletDir, "devenv-mysql-8.4.container")
	data, err := os.ReadFile(unitPath)
	if err != nil {
		t.Fatal(err)
	}
	unit := string(data)
	if !strings.Contains(unit, filepath.Join(paths.DataDir, "mysql-8.4")+":/var/lib/mysql:Z") {
		t.Fatalf("unit has an unsafe or missing data volume:\n%s", unit)
	}
	if strings.Contains(unit, paths.DataDir+"/mysql:8.4") {
		t.Fatalf("unit contains a colon in the host data path:\n%s", unit)
	}
	if !strings.Contains(unit, "NetworkAlias=devenv-mysql") {
		t.Fatalf("default version should get the stable network alias:\n%s", unit)
	}
	if !strings.Contains(unit, "PublishPort=127.0.0.1:") {
		t.Fatalf("unit does not publish the service on localhost:\n%s", unit)
	}
	state, err := config.LoadServiceState(paths)
	if err != nil {
		t.Fatal(err)
	}
	if state.Services["mysql:8.4"].Ports["mysql"] != inst.Port {
		t.Fatalf("state = %+v", state)
	}
	rows, err := m.List(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0][0] != "mysql" || rows[0][1] != "8.4" {
		t.Fatalf("rows = %+v", rows)
	}
}

func TestContainerAndUnitNames(t *testing.T) {
	if got := ContainerName("postgres", "17"); got != "devenv-postgres-17" {
		t.Fatalf("container = %q", got)
	}
	if got := UnitName("postgres", "17"); got != "devenv-postgres-17.service" {
		t.Fatalf("unit = %q", got)
	}
	if got := Key("redis", "7"); got != "redis:7" {
		t.Fatalf("key = %q", got)
	}
}
