// Package tools downloads pinned host tools (Composer, mkcert, fnm) and
// verifies their checksums before installing them.
package tools

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"gopkg.in/yaml.v3"

	assets "devenv/embed"
	"devenv/internal/ui"
)

type Manifest struct {
	Name    string `yaml:"name"`
	Version string `yaml:"version"`
	URL     string `yaml:"url"`
	SHA256  string `yaml:"sha256"`
	Size    int64  `yaml:"size"`
	Kind    string `yaml:"kind"`
	Member  string `yaml:"member"`
}

// LoadManifest reads an embedded manifest by tool name.
func LoadManifest(name string) (Manifest, error) {
	data, err := assets.FS.ReadFile("manifests/" + name + ".yaml")
	if err != nil {
		return Manifest{}, fmt.Errorf("manifiesto %s no encontrado: %w", name, err)
	}
	var m Manifest
	if err := yaml.Unmarshal(data, &m); err != nil {
		return Manifest{}, fmt.Errorf("manifiesto %s inválido: %w", name, err)
	}
	if m.URL == "" || m.SHA256 == "" {
		return Manifest{}, fmt.Errorf("manifiesto %s incompleto (url/sha256)", name)
	}
	return m, nil
}

// Ensure downloads a tool if the destination is missing or its checksum does
// not match. It never downloads in offline mode.
func Ensure(ctx context.Context, name, dest string, u *ui.UI, offline, force bool) (Manifest, error) {
	m, err := LoadManifest(name)
	if err != nil {
		return Manifest{}, err
	}
	if !force {
		if ok, _ := verifyFile(dest, m.SHA256); ok {
			return m, nil
		}
	}
	if offline {
		return Manifest{}, fmt.Errorf("%s no está instalado y el modo offline está activo", name)
	}
	ok, err := u.Confirm(fmt.Sprintf("Descargar %s %s (%s)", name, m.Version, ui.HumanSize(m.Size)))
	if err != nil {
		return Manifest{}, err
	}
	if !ok {
		return Manifest{}, fmt.Errorf("descarga de %s cancelada", name)
	}

	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return Manifest{}, err
	}
	u.Info("Descargando %s %s...", name, m.Version)
	if err := downloadVerified(ctx, m, dest); err != nil {
		return Manifest{}, err
	}
	u.Success("%s %s instalado en %s", name, m.Version, dest)
	return m, nil
}

func downloadVerified(ctx context.Context, m Manifest, dest string) error {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, m.URL, nil)
	if err != nil {
		return err
	}
	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("descargar %s: %w", m.URL, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("descargar %s: HTTP %s", m.URL, resp.Status)
	}

	tmp, err := os.CreateTemp(filepath.Dir(dest), ".devenv-download-*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)

	h := sha256.New()
	if _, err := io.Copy(io.MultiWriter(tmp, h), resp.Body); err != nil {
		tmp.Close()
		return fmt.Errorf("descargar %s: %w", m.URL, err)
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	got := hex.EncodeToString(h.Sum(nil))
	if !strings.EqualFold(got, m.SHA256) {
		return fmt.Errorf("checksum inválido para %s: esperado %s, obtenido %s", m.URL, m.SHA256, got)
	}

	if m.Kind == "zip" {
		if err := extractZipMember(tmpName, m.Member, dest); err != nil {
			return err
		}
		return nil
	}
	if err := os.Rename(tmpName, dest); err != nil {
		return err
	}
	return os.Chmod(dest, 0o755)
}

func extractZipMember(zipPath, member, dest string) error {
	zr, err := zip.OpenReader(zipPath)
	if err != nil {
		return fmt.Errorf("abrir zip: %w", err)
	}
	defer zr.Close()
	for _, f := range zr.File {
		if filepath.Base(f.Name) != member {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return err
		}
		defer rc.Close()
		tmp, err := os.CreateTemp(filepath.Dir(dest), ".devenv-zip-*")
		if err != nil {
			return err
		}
		tmpName := tmp.Name()
		defer os.Remove(tmpName)
		if _, err := io.Copy(tmp, rc); err != nil {
			tmp.Close()
			return err
		}
		if err := tmp.Close(); err != nil {
			return err
		}
		if err := os.Rename(tmpName, dest); err != nil {
			return err
		}
		return os.Chmod(dest, 0o755)
	}
	return fmt.Errorf("el zip no contiene %q", member)
}

func verifyFile(path, want string) (bool, error) {
	f, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return false, err
	}
	return strings.EqualFold(hex.EncodeToString(h.Sum(nil)), want), nil
}

// Verify checks an existing tool against its manifest.
func Verify(name, path string) (bool, error) {
	m, err := LoadManifest(name)
	if err != nil {
		return false, err
	}
	return verifyFile(path, m.SHA256)
}
