// Package ui contains the human-facing output helpers.
package ui

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"
	"text/tabwriter"
)

const (
	ansiReset  = "\033[0m"
	ansiBold   = "\033[1m"
	ansiDim    = "\033[2m"
	ansiRed    = "\033[31m"
	ansiGreen  = "\033[32m"
	ansiYellow = "\033[33m"
	ansiBlue   = "\033[34m"
	ansiCyan   = "\033[36m"
)

// UI centralizes output and confirmations.
type UI struct {
	In      io.Reader
	Out     io.Writer
	Err     io.Writer
	Yes     bool
	JSON    bool
	NoColor bool

	reader *bufio.Reader
}

func New(out, errOut io.Writer) *UI {
	u := &UI{
		In:      os.Stdin,
		Out:     out,
		Err:     errOut,
		NoColor: os.Getenv("NO_COLOR") != "" || !isTerminal(out),
	}
	u.reader = bufio.NewReader(u.In)
	return u
}

func (u *UI) color(code, s string) string {
	if u.NoColor {
		return s
	}
	return code + s + ansiReset
}

func (u *UI) Info(format string, args ...any) {
	fmt.Fprintf(u.Out, format+"\n", args...)
}

func (u *UI) Success(format string, args ...any) {
	fmt.Fprintln(u.Out, u.color(ansiGreen, "✓ ")+fmt.Sprintf(format, args...))
}

func (u *UI) Warn(format string, args ...any) {
	fmt.Fprintln(u.Err, u.color(ansiYellow, "! ")+fmt.Sprintf(format, args...))
}

func (u *UI) Error(format string, args ...any) {
	fmt.Fprintln(u.Err, u.color(ansiRed, "✗ ")+fmt.Sprintf(format, args...))
}

func (u *UI) Dim(format string, args ...any) {
	fmt.Fprintln(u.Out, u.color(ansiDim, fmt.Sprintf(format, args...)))
}

func (u *UI) Heading(format string, args ...any) {
	fmt.Fprintln(u.Out, u.color(ansiBold+ansiCyan, fmt.Sprintf(format, args...)))
}

func (u *UI) Link(url string) {
	fmt.Fprintln(u.Out, u.color(ansiBlue, url))
}

// Confirm asks a yes/no question. In non-interactive mode it fails unless Yes
// was set, which prevents accidental downloads or destructive actions in CI.
func (u *UI) Confirm(question string) (bool, error) {
	if u.Yes {
		u.Info("%s sí (--yes)", question)
		return true, nil
	}
	if !isTerminal(u.In) {
		return false, fmt.Errorf("se requiere confirmación para %q; vuelve a ejecutar con --yes", question)
	}
	fmt.Fprintf(u.Out, "%s [s/N] ", question)
	line, err := u.reader.ReadString('\n')
	if err != nil && len(line) == 0 {
		return false, err
	}
	answer := strings.ToLower(strings.TrimSpace(line))
	return answer == "s" || answer == "si" || answer == "sí" || answer == "y" || answer == "yes", nil
}

// Ask reads a free-form value with a default.
func (u *UI) Ask(question, def string) (string, error) {
	if !isTerminal(u.In) {
		return def, nil
	}
	if def != "" {
		fmt.Fprintf(u.Out, "%s [%s] ", question, def)
	} else {
		fmt.Fprintf(u.Out, "%s ", question)
	}
	line, err := u.reader.ReadString('\n')
	if err != nil && len(line) == 0 {
		return "", err
	}
	answer := strings.TrimSpace(line)
	if answer == "" {
		return def, nil
	}
	return answer, nil
}

// Table prints a simple aligned table.
func (u *UI) Table(headers []string, rows [][]string) {
	w := tabwriter.NewWriter(u.Out, 0, 4, 2, ' ', 0)
	fmt.Fprintln(w, strings.Join(headers, "\t"))
	for _, row := range rows {
		fmt.Fprintln(w, strings.Join(row, "\t"))
	}
	w.Flush()
}

// JSONOut writes an indented JSON document.
func (u *UI) JSONOut(v any) error {
	enc := json.NewEncoder(u.Out)
	enc.SetIndent("", "  ")
	return enc.Encode(v)
}

// HumanSize formats a byte count for download confirmations.
func HumanSize(bytes int64) string {
	if bytes <= 0 {
		return "tamaño desconocido"
	}
	const unit = 1024
	if bytes < unit {
		return fmt.Sprintf("%d B", bytes)
	}
	div, exp := int64(unit), 0
	for n := bytes / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %ciB", float64(bytes)/float64(div), "KMGTPE"[exp])
}

func isTerminal(v any) bool {
	f, ok := v.(*os.File)
	if !ok {
		return false
	}
	info, err := f.Stat()
	if err != nil {
		return false
	}
	return info.Mode()&os.ModeCharDevice != 0
}
