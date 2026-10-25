package project

import (
	"fmt"
	"regexp"
	"strings"
)

// Common TLDs used only to decide whether a directory name that contains dots
// looks like a domain. The list is intentionally conservative; unknown
// suffixes are still normalized, just without dropping the last label.
var knownTLDs = map[string]bool{
	"com": true, "org": true, "net": true, "io": true, "dev": true,
	"app": true, "co": true, "uk": true, "de": true, "es": true,
	"fr": true, "it": true, "nl": true, "us": true, "ca": true,
	"au": true, "br": true, "mx": true, "ar": true, "cl": true,
	"pe": true, "jp": true, "cn": true, "in": true, "ru": true,
	"se": true, "no": true, "fi": true, "dk": true, "pl": true,
	"pt": true, "ch": true, "at": true, "be": true, "cz": true,
	"gr": true, "tr": true, "za": true, "nz": true, "me": true,
	"tv": true, "xyz": true, "online": true, "site": true, "tech": true,
	"store": true, "cloud": true, "ai": true, "eu": true, "info": true,
	"biz": true, "name": true, "pro": true, "mobi": true, "asia": true,
	"test": true, "localhost": true,
}

var (
	invalidNameChars = regexp.MustCompile(`[^a-z0-9.-]+`)
	multiHyphen      = regexp.MustCompile(`-+`)
	labelRE          = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$`)
)

// SanitizeName turns a directory name into a DNS-safe label.
func SanitizeName(name string) string {
	name = strings.ToLower(strings.TrimSpace(name))
	name = strings.ReplaceAll(name, "_", "-")
	name = strings.ReplaceAll(name, " ", "-")
	name = invalidNameChars.ReplaceAllString(name, "-")
	name = multiHyphen.ReplaceAllString(name, "-")
	name = strings.Trim(name, ".-")
	if name == "" {
		return "site"
	}
	if len(name) > 63 {
		name = strings.TrimRight(name[:63], ".-")
	}
	if name == "" {
		return "site"
	}
	return name
}

// DomainFromName applies devenv's directory-to-domain rule:
//   - my-app                -> my-app.test
//   - admin.example.com     -> admin-example.test
//   - v1.2                  -> v1-2.test
func DomainFromName(name, tld string) string {
	tld = strings.TrimPrefix(strings.ToLower(strings.TrimSpace(tld)), ".")
	if tld == "" {
		tld = "test"
	}
	base := SanitizeName(name)
	labels := strings.Split(base, ".")
	if len(labels) > 1 {
		last := labels[len(labels)-1]
		if knownTLDs[last] {
			labels = labels[:len(labels)-1]
		}
		base = strings.Join(labels, "-")
		base = multiHyphen.ReplaceAllString(base, "-")
		base = strings.Trim(base, ".-")
	}
	if base == "" {
		base = "site"
	}
	if strings.HasSuffix(base, "."+tld) {
		return base
	}
	return base + "." + tld
}

// NormalizeExplicitDomain validates a domain supplied by the user or by
// .devenv.yaml. If it has no dot, the configured TLD is appended.
func NormalizeExplicitDomain(domain, tld string) (string, error) {
	d := strings.TrimSpace(strings.ToLower(domain))
	d = strings.TrimSuffix(d, ".")
	if d == "" {
		return "", fmt.Errorf("el dominio no puede estar vacío")
	}
	if strings.Contains(d, "://") || strings.ContainsAny(d, "/\\ \t\r\n") {
		return "", fmt.Errorf("dominio inválido %q: no incluyas esquema, ruta ni espacios", domain)
	}
	if strings.Contains(d, ":") {
		return "", fmt.Errorf("dominio inválido %q: no incluyas puerto", domain)
	}
	tld = strings.TrimPrefix(strings.ToLower(strings.TrimSpace(tld)), ".")
	if tld == "" {
		tld = "test"
	}
	if !strings.Contains(d, ".") {
		d += "." + tld
	}
	if len(d) > 253 {
		return "", fmt.Errorf("dominio demasiado largo: %q", domain)
	}
	for _, label := range strings.Split(d, ".") {
		if !labelRE.MatchString(label) {
			return "", fmt.Errorf("etiqueta de dominio inválida %q en %q", label, domain)
		}
	}
	return d, nil
}

// NormalizeDomain accepts either a folder-style name or an explicit domain and
// always returns a valid hostname. It is used by --domain and .devenv.yaml.
func NormalizeDomain(value, tld string) (string, error) {
	if strings.Contains(value, ".") {
		return NormalizeExplicitDomain(value, tld)
	}
	return DomainFromName(value, tld), nil
}
