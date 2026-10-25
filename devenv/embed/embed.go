// Package assets embeds all templates and static defaults used by devenv.
package assets

import "embed"

// FS contains Quadlet units, nginx templates, PHP build files and the watcher
// unit. Keeping them embedded preserves the single-binary distribution.
//
//go:embed quadlet/*.tmpl nginx/*.tmpl php/* dnsmasq/*.tmpl systemd/*.tmpl manifests/*.yaml
var FS embed.FS
