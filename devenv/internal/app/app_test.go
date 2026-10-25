package app

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"devenv/internal/config"
	"devenv/internal/execx"
	"devenv/internal/ui"
)

func fakeRunner() *execx.FakeRunner {
	return &execx.FakeRunner{
		RunFunc: func(ctx context.Context, name string, args ...string) (string, error) {
			joined := strings.Join(args, " ")
			switch {
			case name == "sysctl":
				return "1024\n", nil
			case strings.HasPrefix(joined, "info "):
				return "true\n", nil
			case strings.HasPrefix(joined, "network inspect"):
				return "", nil
			case strings.HasPrefix(joined, "image exists"):
				return "", nil
			case strings.HasPrefix(joined, "pull "), strings.HasPrefix(joined, "build "):
				return "", nil
			case strings.HasPrefix(joined, "inspect "):
				return "true\n", nil
			case strings.Contains(joined, "nginx -t"):
				return "nginx: configuration file test is successful\n", nil
			case strings.Contains(joined, "nginx -s reload"):
				return "", nil
			case strings.HasPrefix(joined, "exec "):
				return "", nil
			}
			return "", nil
		},
	}
}

func TestLinkUsePHPAndUnlink(t *testing.T) {
	home := t.TempDir()
	root := filepath.Join(home, "my-app")
	if err := os.MkdirAll(filepath.Join(root, "public"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "composer.json"), []byte(`{}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "public", "index.php"), []byte("<?php"), 0o644); err != nil {
		t.Fatal(err)
	}
	oldWD, _ := os.Getwd()
	if err := os.Chdir(root); err != nil {
		t.Fatal(err)
	}
	defer os.Chdir(oldWD)

	paths := config.PathsFromHome(home)
	u := ui.New(io.Discard, io.Discard)
	u.Yes = true
	a, err := New(paths, u, fakeRunner(), false, false)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	site, err := a.Link(ctx, ".", LinkOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if site.Name != "my-app" || site.Domain != "my-app.test" || site.PHP != "8.4" {
		t.Fatalf("site = %+v", site)
	}
	if _, err := os.Stat(filepath.Join(paths.NginxConfD, "my-app.test.conf")); err != nil {
		t.Fatal(err)
	}
	unit, err := os.ReadFile(filepath.Join(paths.QuadletDir, "devenv-php84.container"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(unit), root+":/var/www/sites/my-app:rw") {
		t.Fatalf("PHP unit missing site mount:\n%s", unit)
	}
	nginxUnit, err := os.ReadFile(filepath.Join(paths.QuadletDir, "devenv-nginx.container"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(nginxUnit), root+":/var/www/sites/my-app:ro") {
		t.Fatalf("nginx unit missing site mount:\n%s", nginxUnit)
	}

	if err := a.UsePHP(ctx, "8.3"); err != nil {
		t.Fatal(err)
	}
	sites, err := a.Sites()
	if err != nil {
		t.Fatal(err)
	}
	if len(sites) != 1 || sites[0].PHP != "8.3" {
		t.Fatalf("sites after use = %+v", sites)
	}
	if _, err := os.Stat(filepath.Join(paths.NginxConfD, "my-app.test.conf")); err != nil {
		t.Fatal(err)
	}
	if err := a.Unlink(ctx, "my-app"); err != nil {
		t.Fatal(err)
	}
	sites, err = a.Sites()
	if err != nil {
		t.Fatal(err)
	}
	if len(sites) != 0 {
		t.Fatalf("sites after unlink = %+v", sites)
	}
	if _, err := os.Stat(filepath.Join(paths.NginxConfD, "my-app.test.conf")); !os.IsNotExist(err) {
		t.Fatalf("vhost still exists: %v", err)
	}
	unit84, err := os.ReadFile(filepath.Join(paths.QuadletDir, "devenv-php84.container"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(unit84), root+":/var/www/sites/my-app:rw,z") {
		t.Fatalf("stale site mount remains in PHP 8.4 unit:\n%s", unit84)
	}
	nginxUnit, err = os.ReadFile(filepath.Join(paths.QuadletDir, "devenv-nginx.container"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(nginxUnit), root+":/var/www/sites/my-app:ro,z") {
		t.Fatalf("stale site mount remains in nginx unit:\n%s", nginxUnit)
	}
}
