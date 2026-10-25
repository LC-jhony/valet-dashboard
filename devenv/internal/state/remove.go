package state

import (
	"errors"
	"os"
)

// Remove deletes path, treating a missing file as success.
func Remove(path string) error {
	err := os.Remove(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}
