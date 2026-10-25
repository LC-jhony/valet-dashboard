//go:build linux

package state

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
)

// Lock is an exclusive advisory lock used to serialize mutations of devenv's
// state (nginx configuration, Quadlet units, sites.yaml, ...).
type Lock struct {
	file *os.File
}

// Acquire takes an exclusive, non-blocking flock on path.
func Acquire(path string) (*Lock, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, fmt.Errorf("crear directorio del lock: %w", err)
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, fmt.Errorf("abrir lock %s: %w", path, err)
	}
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		f.Close()
		if errors.Is(err, syscall.EWOULDBLOCK) {
			return nil, fmt.Errorf("otra operación de devenv está en curso (lock: %s)", path)
		}
		return nil, fmt.Errorf("bloquear %s: %w", path, err)
	}
	return &Lock{file: f}, nil
}

// Release unlocks and closes the lock file.
func (l *Lock) Release() error {
	if l == nil || l.file == nil {
		return nil
	}
	err1 := syscall.Flock(int(l.file.Fd()), syscall.LOCK_UN)
	err2 := l.file.Close()
	if err1 != nil {
		return err1
	}
	return err2
}
