// Package execx centralizes process execution so every command can be faked
// in unit tests.
package execx

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
)

// Runner is the subset of os/exec used by devenv.
type Runner interface {
	Run(ctx context.Context, name string, args ...string) (string, error)
	RunSplit(ctx context.Context, name string, args ...string) (stdout, stderr string, err error)
	RunInput(ctx context.Context, name string, stdin io.Reader, args ...string) (string, error)
	RunInteractive(ctx context.Context, name string, args ...string) error
	LookPath(name string) (string, error)
}

// OSRunner executes real processes.
type OSRunner struct {
	Verbose bool
	Out     io.Writer
	Err     io.Writer
}

func (r *OSRunner) log(name string, args []string) {
	if !r.Verbose {
		return
	}
	out := r.Out
	if out == nil {
		out = os.Stderr
	}
	fmt.Fprintf(out, "+ %s %s\n", name, strings.Join(args, " "))
}

// Run executes a command and returns combined stdout/stderr.
func (r *OSRunner) Run(ctx context.Context, name string, args ...string) (string, error) {
	r.log(name, args)
	cmd := exec.CommandContext(ctx, name, args...)
	var buf bytes.Buffer
	cmd.Stdout = &buf
	cmd.Stderr = &buf
	err := cmd.Run()
	out := buf.String()
	if err != nil {
		return out, commandError(name, args, out, err)
	}
	return out, nil
}

// RunSplit executes a command keeping stdout and stderr separate. It is used
// for database dumps, where warnings on stderr must not corrupt the backup.
func (r *OSRunner) RunSplit(ctx context.Context, name string, args ...string) (string, string, error) {
	r.log(name, args)
	cmd := exec.CommandContext(ctx, name, args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	if err != nil {
		return stdout.String(), stderr.String(), commandError(name, args, stderr.String(), err)
	}
	return stdout.String(), stderr.String(), nil
}

// RunInput executes a command with stdin and returns combined output.
func (r *OSRunner) RunInput(ctx context.Context, name string, stdin io.Reader, args ...string) (string, error) {
	r.log(name, args)
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Stdin = stdin
	var buf bytes.Buffer
	cmd.Stdout = &buf
	cmd.Stderr = &buf
	err := cmd.Run()
	out := buf.String()
	if err != nil {
		return out, commandError(name, args, out, err)
	}
	return out, nil
}

// RunInteractive connects the child process to the terminal.
func (r *OSRunner) RunInteractive(ctx context.Context, name string, args ...string) error {
	r.log(name, args)
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		return commandError(name, args, "", err)
	}
	return nil
}

func (r *OSRunner) LookPath(name string) (string, error) {
	return exec.LookPath(name)
}

func commandError(name string, args []string, output string, err error) error {
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		msg := strings.TrimSpace(output)
		if msg == "" {
			msg = strings.TrimSpace(string(exitErr.Stderr))
		}
		if msg == "" {
			return fmt.Errorf("%s %s: %w", name, strings.Join(args, " "), err)
		}
		return fmt.Errorf("%s %s: %w\n%s", name, strings.Join(args, " "), err, msg)
	}
	return fmt.Errorf("%s %s: %w", name, strings.Join(args, " "), err)
}

// Call records one fake invocation.
type Call struct {
	Name  string
	Args  []string
	Input string
}

// FakeRunner is a configurable Runner for tests.
type FakeRunner struct {
	RunFunc            func(ctx context.Context, name string, args ...string) (string, error)
	RunSplitFunc       func(ctx context.Context, name string, args ...string) (string, string, error)
	RunInputFunc       func(ctx context.Context, name string, stdin io.Reader, args ...string) (string, error)
	RunInteractiveFunc func(ctx context.Context, name string, args ...string) error
	LookPathFunc       func(name string) (string, error)
	Calls              []Call
}

func (f *FakeRunner) Run(ctx context.Context, name string, args ...string) (string, error) {
	f.Calls = append(f.Calls, Call{Name: name, Args: append([]string(nil), args...)})
	if f.RunFunc != nil {
		return f.RunFunc(ctx, name, args...)
	}
	return "", nil
}

func (f *FakeRunner) RunSplit(ctx context.Context, name string, args ...string) (string, string, error) {
	f.Calls = append(f.Calls, Call{Name: name, Args: append([]string(nil), args...)})
	if f.RunSplitFunc != nil {
		return f.RunSplitFunc(ctx, name, args...)
	}
	return "", "", nil
}

func (f *FakeRunner) RunInput(ctx context.Context, name string, stdin io.Reader, args ...string) (string, error) {
	var data string
	if stdin != nil {
		b, _ := io.ReadAll(stdin)
		data = string(b)
	}
	f.Calls = append(f.Calls, Call{Name: name, Args: append([]string(nil), args...), Input: data})
	if f.RunInputFunc != nil {
		return f.RunInputFunc(ctx, name, stdin, args...)
	}
	return "", nil
}

func (f *FakeRunner) RunInteractive(ctx context.Context, name string, args ...string) error {
	f.Calls = append(f.Calls, Call{Name: name, Args: append([]string(nil), args...)})
	if f.RunInteractiveFunc != nil {
		return f.RunInteractiveFunc(ctx, name, args...)
	}
	return nil
}

func (f *FakeRunner) LookPath(name string) (string, error) {
	if f.LookPathFunc != nil {
		return f.LookPathFunc(name)
	}
	return "/usr/bin/" + name, nil
}
