// Package state provides small helpers for durable, atomic state files.
package state

import (
	"fmt"
	"os"
	"path/filepath"

	"gopkg.in/yaml.v3"
)

// WriteFile writes data to path atomically by writing a temporary file in the
// same directory and renaming it over the destination.
func WriteFile(path string, data []byte, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("crear directorio de %s: %w", path, err)
	}

	tmp, err := os.CreateTemp(filepath.Dir(path), "."+filepath.Base(path)+".tmp-*")
	if err != nil {
		return fmt.Errorf("crear temporal para %s: %w", path, err)
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)

	if err := tmp.Chmod(mode); err != nil {
		tmp.Close()
		return fmt.Errorf("permisos de %s: %w", path, err)
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return fmt.Errorf("escribir %s: %w", path, err)
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return fmt.Errorf("sincronizar %s: %w", path, err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("cerrar %s: %w", path, err)
	}
	if err := os.Rename(tmpName, path); err != nil {
		return fmt.Errorf("reemplazar %s: %w", path, err)
	}
	return nil
}

// WriteYAML serializes v as YAML and writes it atomically.
func WriteYAML(path string, v any, mode os.FileMode) error {
	data, err := yaml.Marshal(v)
	if err != nil {
		return fmt.Errorf("serializar YAML %s: %w", path, err)
	}
	return WriteFile(path, data, mode)
}

// ReadYAML reads and decodes a YAML file. A missing file is returned as
// os.ErrNotExist so callers can decide whether that is an error.
func ReadYAML(path string, v any) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	if err := yaml.Unmarshal(data, v); err != nil {
		return fmt.Errorf("leer YAML %s: %w", path, err)
	}
	return nil
}
