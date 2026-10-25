package nginx

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
	"devenv/internal/ui"
)

func testManager(t *testing.T) (*Manager, *execx.FakeRunner) {
	t.Helper()
	home := t.TempDir()
	paths := config.PathsFromHome(home)
	if err := paths.Ensure(); err != nil {
		t.Fatal(err)
	}
	runner := &execx.FakeRunner{
		RunFunc: func(ctx context.Context, name string, args ...string) (string, error) {
			joined := strings.Join(args, " ")
			if strings.HasPrefix(joined, "inspect ") {
				return "true\n", nil
			}
			if strings.Contains(joined, "nginx -t") {
				return "nginx: configuration file test is successful\n", nil
			}
			if strings.Contains(joined, "nginx -s reload") {
				return "", nil
			}
			return "", nil
		},
	}
	u := ui.New(io.Discard, io.Discard)
	return &Manager{
		Paths:  paths,
		Podman: &podman.Client{Runner: runner, UI: u},
		UI:     u,
	}, runner
}

func TestRenderHTTPAndHTTPS(t *testing.T) {
	m, _ := testManager(t)
	site := config.Site{Name: "foo", Domain: "foo.test", DocRoot: "public", PHP: "8.4"}
	http, err := m.Render(site)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"server_name foo.test;", "root /var/www/sites/foo/public;", "devenv-php84-fpm:9000"} {
		if !strings.Contains(http, want) {
			t.Errorf("HTTP vhost missing %q:\n%s", want, http)
		}
	}
	site.Secure = true
	https, err := m.Render(site)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(https, "ssl_certificate     /etc/nginx/certs/sites/foo.test.crt;") {
		t.Errorf("HTTPS vhost missing certificate:\n%s", https)
	}
	if !strings.Contains(https, "return 301 https://$host$request_uri;") {
		t.Errorf("default HTTPS port should not be added to redirect:\n%s", https)
	}
	m.HTTPSPort = 8443
	https, err = m.Render(site)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(https, "return 301 https://$host:8443$request_uri;") {
		t.Errorf("custom HTTPS port missing from redirect:\n%s", https)
	}
}

func TestApplySuccessAndRollback(t *testing.T) {
	m, runner := testManager(t)
	ctx := context.Background()
	siteA := config.Site{Name: "foo", Domain: "foo.test", DocRoot: "public", PHP: "8.4"}
	if err := m.Apply(ctx, []config.Site{siteA}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(m.Paths.NginxConfD, "foo.test.conf")); err != nil {
		t.Fatal(err)
	}

	runner.RunFunc = func(ctx context.Context, name string, args ...string) (string, error) {
		joined := strings.Join(args, " ")
		if strings.HasPrefix(joined, "inspect ") {
			return "true\n", nil
		}
		if strings.Contains(joined, "nginx -t") {
			return "nginx: [emerg] invalid configuration", os.ErrInvalid
		}
		return "", nil
	}
	siteB := config.Site{Name: "bar", Domain: "bar.test", DocRoot: "public", PHP: "8.3"}
	err := m.Apply(ctx, []config.Site{siteA, siteB})
	if err == nil {
		t.Fatal("expected nginx validation failure")
	}
	if _, statErr := os.Stat(filepath.Join(m.Paths.NginxConfD, "foo.test.conf")); statErr != nil {
		t.Fatalf("old vhost was not restored: %v", statErr)
	}
	if _, statErr := os.Stat(filepath.Join(m.Paths.NginxConfD, "bar.test.conf")); !os.IsNotExist(statErr) {
		t.Fatalf("new vhost should have been rolled back, stat err = %v", statErr)
	}
}
