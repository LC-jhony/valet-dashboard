package quadlet

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"devenv/internal/config"
)

func testPaths(t *testing.T) config.Paths {
	t.Helper()
	paths := config.PathsFromHome(t.TempDir())
	if err := paths.Ensure(); err != nil {
		t.Fatal(err)
	}
	return paths
}

func TestInstallNginxUnit(t *testing.T) {
	paths := testPaths(t)
	m := &Manager{Paths: paths}
	unit, err := m.InstallNginx(NginxData{
		Image: "docker.io/library/nginx:alpine", HTTPPort: 8080, HTTPSPort: 8443,
		NginxConf: paths.NginxConf, NginxConfD: paths.NginxConfD,
		CertsDir: paths.CertsDir, NginxLogs: paths.NginxLogs,
		Sites:    []SiteMount{{HostPath: "/projects/foo", ContainerPath: "/var/www/sites/foo"}},
		PHPUnits: []string{"devenv-php84.service"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if unit != "devenv-nginx.service" {
		t.Fatalf("unit = %q", unit)
	}
	data, err := os.ReadFile(filepath.Join(paths.QuadletDir, "devenv-nginx.container"))
	if err != nil {
		t.Fatal(err)
	}
	content := string(data)
	for _, want := range []string{
		"PublishPort=8080:80",
		"PublishPort=8443:443",
		"Wants=devenv-php84.service",
		"After=devenv-php84.service",
		"Volume=/projects/foo:/var/www/sites/foo:ro,z",
	} {
		if !strings.Contains(content, want) {
			t.Errorf("nginx unit missing %q:\n%s", want, content)
		}
	}
}

func TestInstallPHPUnit(t *testing.T) {
	paths := testPaths(t)
	m := &Manager{Paths: paths}
	unit, err := m.InstallPHP(PHPData{
		Version: "8.4", NoDot: "84", Image: "localhost/devenv-php84:latest",
		BinDir: paths.BinDir,
		Sites:  []SiteMount{{HostPath: "/projects/foo", ContainerPath: "/var/www/sites/foo"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if unit != "devenv-php84.service" {
		t.Fatalf("unit = %q", unit)
	}
	data, err := os.ReadFile(filepath.Join(paths.QuadletDir, "devenv-php84.container"))
	if err != nil {
		t.Fatal(err)
	}
	content := string(data)
	for _, want := range []string{
		"ContainerName=devenv-php84-fpm",
		"UserNS=keep-id",
		"Volume=/projects/foo:/var/www/sites/foo:rw,z",
		"Volume=" + paths.BinDir + ":/opt/devenv/bin:ro,z",
	} {
		if !strings.Contains(content, want) {
			t.Errorf("PHP unit missing %q:\n%s", want, content)
		}
	}
}

func TestInstallServiceUnit(t *testing.T) {
	paths := testPaths(t)
	m := &Manager{Paths: paths}
	_, err := m.InstallService(ServiceData{
		Name: "mysql", Version: "8.4", ContainerName: "devenv-mysql-8.4",
		Image: "docker.io/library/mysql:8.4", NetworkAlias: "devenv-mysql",
		Volumes: []string{paths.DataDir + "/mysql-8.4:/var/lib/mysql:Z"},
		Env:     []string{"MYSQL_ROOT_PASSWORD=secret"}, PublishPorts: []string{"127.0.0.1:3306:3306/tcp"},
		HealthCmd: "mysqladmin ping -h 127.0.0.1 -u root -psecret",
	})
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(paths.QuadletDir, "devenv-mysql-8.4.container"))
	if err != nil {
		t.Fatal(err)
	}
	content := string(data)
	for _, want := range []string{
		"NetworkAlias=devenv-mysql",
		"Environment=MYSQL_ROOT_PASSWORD=secret",
		"PublishPort=127.0.0.1:3306:3306/tcp",
		"HealthCmd=mysqladmin ping",
	} {
		if !strings.Contains(content, want) {
			t.Errorf("service unit missing %q:\n%s", want, content)
		}
	}
}
