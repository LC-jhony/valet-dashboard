// Package watcher keeps parked directories in sync using inotify.
package watcher

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"

	"devenv/internal/ui"
)

type Handler func(path string)

// Run watches parked roots and calls handler when a project appears or its
// .devenv.yaml/.php-version changes. It blocks until ctx is cancelled.
func Run(ctx context.Context, dirs []string, handler Handler, u *ui.UI) error {
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return err
	}
	defer w.Close()

	seen := map[string]bool{}
	var mu sync.Mutex
	var timers = map[string]*time.Timer{}

	add := func(dir string) {
		mu.Lock()
		defer mu.Unlock()
		if seen[dir] {
			return
		}
		if err := w.Add(dir); err != nil {
			return
		}
		seen[dir] = true
	}
	schedule := func(path string) {
		mu.Lock()
		defer mu.Unlock()
		if t, ok := timers[path]; ok {
			t.Stop()
		}
		timers[path] = time.AfterFunc(2*time.Second, func() {
			mu.Lock()
			delete(timers, path)
			mu.Unlock()
			handler(path)
		})
	}

	for _, dir := range dirs {
		if info, err := os.Stat(dir); err != nil || !info.IsDir() {
			continue
		}
		add(dir)
		entries, _ := os.ReadDir(dir)
		for _, entry := range entries {
			if entry.IsDir() && !strings.HasPrefix(entry.Name(), ".") && entry.Name() != "node_modules" && entry.Name() != "vendor" {
				add(filepath.Join(dir, entry.Name()))
			}
		}
	}
	u.Info("Watcher activo en %s", strings.Join(dirs, ", "))

	for {
		select {
		case <-ctx.Done():
			return nil
		case err, ok := <-w.Errors:
			if !ok {
				return nil
			}
			u.Warn("watcher: %v", err)
		case ev, ok := <-w.Events:
			if !ok {
				return nil
			}
			base := filepath.Base(ev.Name)
			if ev.Op&fsnotify.Create != 0 {
				if info, err := os.Stat(ev.Name); err == nil && info.IsDir() {
					add(ev.Name)
					schedule(ev.Name)
					continue
				}
			}
			if base == ".devenv.yaml" || base == ".php-version" || base == "composer.json" || base == "index.php" {
				schedule(filepath.Dir(ev.Name))
			}
		}
	}
}

// Discover returns immediate subdirectories that look like projects.
func Discover(root string) ([]string, error) {
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil, fmt.Errorf("leer %s: %w", root, err)
	}
	var out []string
	for _, entry := range entries {
		if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") || entry.Name() == "node_modules" || entry.Name() == "vendor" {
			continue
		}
		dir := filepath.Join(root, entry.Name())
		if looksLikeProject(dir) {
			out = append(out, dir)
		}
	}
	return out, nil
}

func looksLikeProject(dir string) bool {
	for _, marker := range []string{"composer.json", "index.php", ".devenv.yaml", "public/index.php"} {
		if _, err := os.Stat(filepath.Join(dir, marker)); err == nil {
			return true
		}
	}
	return false
}
