package project

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/Masterminds/semver/v3"

	"devenv/internal/config"
)

// Resolved is the effective configuration for one project after applying the
// precedence rules for PHP, Node, domain and document root.
type Resolved struct {
	Root          string
	Name          string
	Domain        string
	DocRoot       string
	PHP           string
	PHPSource     string
	Node          string
	NodeSource    string
	Project       config.Project
	ProjectExists bool
	Site          config.Site
}

// DomainTakenError means the desired domain already belongs to another path.
type DomainTakenError struct {
	Domain string
	Path   string
}

func (e *DomainTakenError) Error() string {
	return fmt.Sprintf("el dominio %s ya está registrado para %s", e.Domain, e.Path)
}

// FindRoot walks up from start looking for project markers.
func FindRoot(start string) (string, error) {
	abs, err := filepath.Abs(start)
	if err != nil {
		return "", fmt.Errorf("resolver ruta %s: %w", start, err)
	}
	info, err := os.Stat(abs)
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		abs = filepath.Dir(abs)
	}
	dir := abs
	for {
		if exists(filepath.Join(dir, ".devenv.yaml")) ||
			exists(filepath.Join(dir, "composer.json")) ||
			exists(filepath.Join(dir, ".git")) ||
			exists(filepath.Join(dir, "index.php")) ||
			exists(filepath.Join(dir, "public", "index.php")) {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return abs, nil
		}
		dir = parent
	}
}

// Resolve computes the effective project configuration.
func Resolve(start string, cfg config.Config, sites config.Sites, domainOverride, nameOverride string) (Resolved, error) {
	root, err := FindRoot(start)
	if err != nil {
		return Resolved{}, err
	}
	proj, projExists, err := config.LoadProject(root)
	if err != nil {
		return Resolved{}, err
	}

	name := SanitizeName(filepath.Base(root))
	if nameOverride != "" {
		name = SanitizeName(nameOverride)
	}

	var domain string
	switch {
	case domainOverride != "":
		domain, err = NormalizeDomain(domainOverride, cfg.TLD)
	case proj.Domain != "":
		domain, err = NormalizeDomain(proj.Domain, cfg.TLD)
	default:
		domain = DomainFromName(name, cfg.TLD)
	}
	if err != nil {
		return Resolved{}, err
	}
	if idx, ok := sites.FindByDomain(domain); ok && filepath.Clean(sites.Sites[idx].Path) != filepath.Clean(root) {
		return Resolved{}, &DomainTakenError{Domain: domain, Path: sites.Sites[idx].Path}
	}

	php, phpSource, err := resolvePHP(root, proj, cfg)
	if err != nil {
		return Resolved{}, err
	}
	node, nodeSource, err := resolveNode(root, proj, cfg)
	if err != nil {
		return Resolved{}, err
	}
	docRoot, err := detectDocRoot(root, proj)
	if err != nil {
		return Resolved{}, err
	}

	site := config.Site{
		Name:      name,
		Path:      root,
		Domain:    domain,
		DocRoot:   docRoot,
		PHP:       php,
		Secure:    proj.Secure != nil && *proj.Secure,
		Source:    "link",
		UpdatedAt: time.Now().UTC(),
	}
	return Resolved{
		Root:          root,
		Name:          name,
		Domain:        domain,
		DocRoot:       docRoot,
		PHP:           php,
		PHPSource:     phpSource,
		Node:          node,
		NodeSource:    nodeSource,
		Project:       proj,
		ProjectExists: projExists,
		Site:          site,
	}, nil
}

// RefreshSite re-resolves an existing site so global PHP changes are reflected
// in sites that do not override the version.
func RefreshSite(site config.Site, cfg config.Config, sites config.Sites) (config.Site, error) {
	r, err := Resolve(site.Path, cfg, sites, site.Domain, site.Name)
	if err != nil {
		return site, err
	}
	r.Site.Source = site.Source
	r.Site.Secure = site.Secure
	r.Site.UpdatedAt = time.Now().UTC()
	return r.Site, nil
}

func resolvePHP(root string, proj config.Project, cfg config.Config) (string, string, error) {
	if raw, ok, err := readVersionFile(root, ".php-version"); err != nil {
		return "", "", err
	} else if ok {
		v, err := NormalizePHPVersion(raw, cfg.PHP.Supported)
		return v, ".php-version", err
	}
	if strings.TrimSpace(proj.PHPVersion) != "" {
		v, err := NormalizePHPVersion(proj.PHPVersion, cfg.PHP.Supported)
		return v, ".devenv.yaml", err
	}
	if constraint, ok, err := composerPHP(root); err != nil {
		return "", "", err
	} else if ok {
		v, err := ResolvePHPConstraint(constraint, cfg.PHP.Supported, cfg.PHP.Default)
		return v, "composer.json", err
	}
	return cfg.PHP.Default, "global", nil
}

func resolveNode(root string, proj config.Project, cfg config.Config) (string, string, error) {
	for _, name := range []string{".nvmrc", ".node-version"} {
		if raw, ok, err := readVersionFile(root, name); err != nil {
			return "", "", err
		} else if ok {
			return normalizeNodeSpec(raw), name, nil
		}
	}
	if strings.TrimSpace(proj.NodeVersion) != "" {
		return normalizeNodeSpec(proj.NodeVersion), ".devenv.yaml", nil
	}
	if v, ok, err := packageEnginesNode(root); err != nil {
		return "", "", err
	} else if ok {
		return normalizeNodeSpec(v), "package.json", nil
	}
	if v, ok, err := toolVersionsNode(root); err != nil {
		return "", "", err
	} else if ok {
		return normalizeNodeSpec(v), ".tool-versions", nil
	}
	return normalizeNodeSpec(cfg.Node.Default), "global", nil
}

// NormalizePHPVersion accepts 8.3, 8.3.12, php@8.3, php-8.3 and returns the
// supported major.minor version.
func NormalizePHPVersion(raw string, supported []string) (string, error) {
	v := strings.TrimSpace(strings.ToLower(raw))
	v = strings.TrimPrefix(v, "php@")
	v = strings.TrimPrefix(v, "php-")
	v = strings.TrimPrefix(v, "v")
	re := regexp.MustCompile(`^(\d+)\.(\d+)(?:\.\d+)?$`)
	m := re.FindStringSubmatch(v)
	if m == nil {
		return "", fmt.Errorf("versión PHP inválida %q", raw)
	}
	minor := m[1] + "." + m[2]
	for _, s := range supported {
		if s == minor {
			return minor, nil
		}
	}
	return "", fmt.Errorf("PHP %s no está soportado (disponibles: %s)", minor, strings.Join(supported, ", "))
}

// ResolvePHPConstraint maps a composer require.php constraint to a supported
// version. A caret/tilde/exact minor such as ^8.2 resolves to 8.2 (the
// project's declared floor), matching devenv's documented behavior.
func ResolvePHPConstraint(constraint string, supported []string, fallback string) (string, error) {
	c := strings.TrimSpace(constraint)
	if c == "" || c == "*" {
		if fallback != "" {
			return fallback, nil
		}
		if len(supported) > 0 {
			return supported[len(supported)-1], nil
		}
		return "", fmt.Errorf("no hay versiones PHP disponibles")
	}

	prefRE := regexp.MustCompile(`^\s*[\^~]?\s*v?(\d+)\.(\d+)(?:\.\d+)?(?:\.\*)?\s*$`)
	if m := prefRE.FindStringSubmatch(c); m != nil {
		pref := m[1] + "." + m[2]
		if contains(supported, pref) {
			if sc, err := semver.NewConstraint(c); err == nil {
				if v, err := semver.NewVersion(pref); err == nil && sc.Check(v) {
					return pref, nil
				}
			}
		}
	}

	sc, err := semver.NewConstraint(c)
	if err != nil {
		return "", fmt.Errorf("constraint PHP inválido %q: %w", constraint, err)
	}
	versions := append([]string(nil), supported...)
	sort.SliceStable(versions, func(i, j int) bool {
		vi, ei := semver.NewVersion(versions[i])
		vj, ej := semver.NewVersion(versions[j])
		if ei != nil || ej != nil {
			return versions[i] > versions[j]
		}
		return vi.GreaterThan(vj)
	})
	for _, s := range versions {
		v, err := semver.NewVersion(s)
		if err == nil && sc.Check(v) {
			return s, nil
		}
	}
	return "", fmt.Errorf("ninguna versión PHP soportada (%s) cumple %q", strings.Join(supported, ", "), constraint)
}

func readVersionFile(root, name string) (string, bool, error) {
	data, err := os.ReadFile(filepath.Join(root, name))
	if errors.Is(err, os.ErrNotExist) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		return line, true, nil
	}
	return "", false, nil
}

func composerPHP(root string) (string, bool, error) {
	data, err := os.ReadFile(filepath.Join(root, "composer.json"))
	if errors.Is(err, os.ErrNotExist) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	var doc struct {
		Require map[string]string `json:"require"`
	}
	if err := json.Unmarshal(data, &doc); err != nil {
		return "", false, fmt.Errorf("composer.json inválido en %s: %w", root, err)
	}
	v, ok := doc.Require["php"]
	return v, ok && strings.TrimSpace(v) != "", nil
}

func packageEnginesNode(root string) (string, bool, error) {
	data, err := os.ReadFile(filepath.Join(root, "package.json"))
	if errors.Is(err, os.ErrNotExist) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	var doc struct {
		Engines map[string]string `json:"engines"`
	}
	if err := json.Unmarshal(data, &doc); err != nil {
		return "", false, fmt.Errorf("package.json inválido en %s: %w", root, err)
	}
	v, ok := doc.Engines["node"]
	return v, ok && strings.TrimSpace(v) != "", nil
}

func toolVersionsNode(root string) (string, bool, error) {
	data, err := os.ReadFile(filepath.Join(root, ".tool-versions"))
	if errors.Is(err, os.ErrNotExist) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(strings.TrimSpace(line))
		if len(fields) >= 2 && (fields[0] == "nodejs" || fields[0] == "node") {
			return fields[1], true, nil
		}
	}
	return "", false, nil
}

func normalizeNodeSpec(raw string) string {
	v := strings.TrimSpace(raw)
	if strings.HasPrefix(v, "v") && len(v) > 1 && v[1] >= '0' && v[1] <= '9' {
		v = v[1:]
	}
	return v
}

func detectDocRoot(root string, proj config.Project) (string, error) {
	if strings.TrimSpace(proj.DocRoot) != "" {
		d := path.Clean(strings.TrimSpace(proj.DocRoot))
		if d == ".." || strings.HasPrefix(d, "../") || path.IsAbs(d) {
			return "", fmt.Errorf("docroot inválido %q: debe ser una ruta relativa dentro del proyecto", proj.DocRoot)
		}
		return d, nil
	}
	if exists(filepath.Join(root, "public", "index.php")) || exists(filepath.Join(root, "public")) {
		return "public", nil
	}
	if exists(filepath.Join(root, "web", "index.php")) {
		return "web", nil
	}
	return ".", nil
}

// ContainerRoot is the directory where a site is mounted inside nginx and FPM.
func ContainerRoot(siteName string) string {
	return path.Join("/var/www/sites", siteName)
}

// ContainerDocRoot returns the absolute document root inside the containers.
func ContainerDocRoot(site config.Site) string {
	root := ContainerRoot(site.Name)
	if site.DocRoot == "" || site.DocRoot == "." {
		return root
	}
	return path.Join(root, site.DocRoot)
}

// ContainerWorkdir returns the project directory inside the containers.
func ContainerWorkdir(site config.Site) string {
	return ContainerRoot(site.Name)
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func contains(list []string, value string) bool {
	for _, item := range list {
		if item == value {
			return true
		}
	}
	return false
}
