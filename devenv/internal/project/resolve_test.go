package project

import (
	"os"
	"path/filepath"
	"testing"

	"devenv/internal/config"
)

func writeFile(t *testing.T, root, name, content string) {
	t.Helper()
	path := filepath.Join(root, name)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func testConfig() config.Config {
	cfg := config.DefaultConfigForHome("/home/test")
	cfg.PHP.Default = "8.4"
	return cfg
}

func TestNormalizePHPVersion(t *testing.T) {
	supported := []string{"8.1", "8.2", "8.3", "8.4", "8.5"}
	cases := map[string]string{
		"8.3":     "8.3",
		"8.3.12":  "8.3",
		"php@8.2": "8.2",
		"php-8.1": "8.1",
		"v8.5":    "8.5",
	}
	for in, want := range cases {
		got, err := NormalizePHPVersion(in, supported)
		if err != nil || got != want {
			t.Errorf("NormalizePHPVersion(%q) = %q, %v; want %q", in, got, err, want)
		}
	}
	if _, err := NormalizePHPVersion("7.4", supported); err == nil {
		t.Error("expected unsupported version error")
	}
}

func TestResolvePHPConstraint(t *testing.T) {
	supported := []string{"8.1", "8.2", "8.3", "8.4", "8.5"}
	cases := []struct {
		constraint string
		want       string
	}{
		{"^8.2", "8.2"},
		{"~8.3.0", "8.3"},
		{"8.1.*", "8.1"},
		{">=8.1 <8.4", "8.3"},
		{"^8.0", "8.5"},
		{"*", "8.4"},
	}
	for _, tc := range cases {
		got, err := ResolvePHPConstraint(tc.constraint, supported, "8.4")
		if err != nil || got != tc.want {
			t.Errorf("ResolvePHPConstraint(%q) = %q, %v; want %q", tc.constraint, got, err, tc.want)
		}
	}
	if _, err := ResolvePHPConstraint("^7.4", supported, "8.4"); err == nil {
		t.Error("expected no matching version error")
	}
}

func TestResolvePrecedence(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "composer.json", `{"require":{"php":"^8.2"}}`)
	writeFile(t, root, "public/index.php", "<?php")
	writeFile(t, root, ".nvmrc", "20.11.1\n")

	r, err := Resolve(root, testConfig(), config.Sites{}, "", "")
	if err != nil {
		t.Fatal(err)
	}
	if r.PHP != "8.2" || r.PHPSource != "composer.json" {
		t.Fatalf("PHP = %s (%s), want 8.2 composer.json", r.PHP, r.PHPSource)
	}
	if r.Node != "20.11.1" || r.NodeSource != ".nvmrc" {
		t.Fatalf("Node = %s (%s)", r.Node, r.NodeSource)
	}
	if r.DocRoot != "public" {
		t.Fatalf("DocRoot = %q", r.DocRoot)
	}

	writeFile(t, root, ".devenv.yaml", "php_version: \"8.1\"\nnode_version: \"18\"\n")
	r, err = Resolve(root, testConfig(), config.Sites{}, "", "")
	if err != nil {
		t.Fatal(err)
	}
	if r.PHP != "8.1" || r.PHPSource != ".devenv.yaml" {
		t.Fatalf("PHP = %s (%s), want .devenv.yaml 8.1", r.PHP, r.PHPSource)
	}
	if r.Node != "20.11.1" {
		t.Fatalf(".nvmrc must beat .devenv.yaml, got %s", r.Node)
	}

	writeFile(t, root, ".php-version", "8.3\n")
	r, err = Resolve(root, testConfig(), config.Sites{}, "", "")
	if err != nil {
		t.Fatal(err)
	}
	if r.PHP != "8.3" || r.PHPSource != ".php-version" {
		t.Fatalf("PHP = %s (%s), want .php-version 8.3", r.PHP, r.PHPSource)
	}
}

func TestResolveNodeSources(t *testing.T) {
	cases := []struct {
		name   string
		files  map[string]string
		want   string
		source string
	}{
		{
			name:   "node-version",
			files:  map[string]string{".node-version": "v21.2.0"},
			want:   "21.2.0",
			source: ".node-version",
		},
		{
			name:   "package-engines",
			files:  map[string]string{"package.json": `{"engines":{"node":">=20"}}`},
			want:   ">=20",
			source: "package.json",
		},
		{
			name:   "tool-versions",
			files:  map[string]string{".tool-versions": "ruby 3.3.0\nnodejs 22.1.0\n"},
			want:   "22.1.0",
			source: ".tool-versions",
		},
		{
			name:   "global",
			files:  map[string]string{},
			want:   "22",
			source: "global",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			writeFile(t, root, "composer.json", `{"require":{"php":"^8.2"}}`)
			for name, content := range tc.files {
				writeFile(t, root, name, content)
			}
			r, err := Resolve(root, testConfig(), config.Sites{}, "", "")
			if err != nil {
				t.Fatal(err)
			}
			if r.Node != tc.want || r.NodeSource != tc.source {
				t.Fatalf("Node = %s (%s), want %s (%s)", r.Node, r.NodeSource, tc.want, tc.source)
			}
		})
	}
}

func TestResolveDomainAndCollision(t *testing.T) {
	root := filepath.Join(t.TempDir(), "my-app")
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	writeFile(t, root, "composer.json", `{}`)
	sites := config.Sites{Version: 1, Sites: []config.Site{
		{Name: "other", Path: "/tmp/other", Domain: "my-app.test"},
	}}
	if _, err := Resolve(root, testConfig(), sites, "", ""); err == nil {
		t.Fatal("expected domain collision error")
	}
	r, err := Resolve(root, testConfig(), sites, "custom.example.test", "")
	if err != nil {
		t.Fatal(err)
	}
	if r.Domain != "custom.example.test" {
		t.Fatalf("domain = %q", r.Domain)
	}
}

func TestContainerDocRoot(t *testing.T) {
	site := config.Site{Name: "foo", DocRoot: "public"}
	if got := ContainerRoot("foo"); got != "/var/www/sites/foo" {
		t.Fatalf("root = %q", got)
	}
	if got := ContainerDocRoot(site); got != "/var/www/sites/foo/public" {
		t.Fatalf("docroot = %q", got)
	}
	site.DocRoot = "."
	if got := ContainerDocRoot(site); got != "/var/www/sites/foo" {
		t.Fatalf("dot docroot = %q", got)
	}
}
