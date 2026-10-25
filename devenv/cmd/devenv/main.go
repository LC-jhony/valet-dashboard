package main

import (
	"os"

	"devenv/internal/cli"
)

func main() {
	os.Exit(cli.Execute())
}
