package db

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"devenv/internal/config"
	"devenv/internal/service"
)

func mailDefinition() service.Definition {
	return service.Definition{
		Name: "mailpit",
		Ports: []service.PortSpec{
			{Name: "smtp", Default: 1025, Container: 1025},
			{Name: "http", Default: 8025, Container: 8025},
		},
		NetworkAlias: "devenv-mailpit",
	}
}

func TestMailVarsUsesContainerPort(t *testing.T) {
	vars := MailVars(mailDefinition(), "devenv-mailpit")
	if got := vars["MAIL_PORT"]; got != "1025" {
		t.Fatalf("MAIL_PORT = %q, want 1025 (container port)", got)
	}
	if got := vars["MAIL_HOST"]; got != "devenv-mailpit" {
		t.Fatalf("MAIL_HOST = %q", got)
	}
	if got := vars["MAIL_MAILER"]; got != "smtp" {
		t.Fatalf("MAIL_MAILER = %q", got)
	}
	if got := vars["MAIL_ENCRYPTION"]; got != "null" {
		t.Fatalf("MAIL_ENCRYPTION = %q", got)
	}
}

func TestMailVarsFallsBackToContainerPort(t *testing.T) {
	vars := MailVars(service.Definition{Name: "mailpit"}, "devenv-mailpit")
	if got := vars["MAIL_PORT"]; got != "1025" {
		t.Fatalf("MAIL_PORT = %q, want 1025", got)
	}
}

func TestSMTPContainerPortIgnoresPublishedPort(t *testing.T) {
	inst := config.ServiceInstance{Name: "mailpit", Ports: map[string]int{"smtp": 2525}}
	def := mailDefinition()
	if got := SMTPContainerPort(def); got != 1025 {
		t.Fatalf("SMTPContainerPort = %d, want 1025", got)
	}
	if got := inst.Ports["smtp"]; got != 2525 {
		t.Fatalf("unexpected published port %d", got)
	}
}

func TestMergeEnvKeepsOtherManagedKeys(t *testing.T) {
	root := t.TempDir()
	m := &Manager{}
	if err := m.WriteEnv(root, map[string]string{"DB_HOST": "devenv-mysql"}); err != nil {
		t.Fatal(err)
	}
	if err := m.MergeEnv(root, map[string]string{"MAIL_PORT": "2525"}); err != nil {
		t.Fatal(err)
	}
	if err := m.MergeEnv(root, map[string]string{"MAIL_PORT": "2526"}); err != nil {
		t.Fatal(err)
	}

	data, err := os.ReadFile(filepath.Join(root, ".env"))
	if err != nil {
		t.Fatal(err)
	}
	text := string(data)
	if !strings.Contains(text, "DB_HOST=devenv-mysql") {
		t.Fatalf("MergeEnv dropped an existing key:\n%s", text)
	}
	if !strings.Contains(text, "MAIL_PORT=2526") {
		t.Fatalf("MergeEnv did not replace the value:\n%s", text)
	}
	if strings.Contains(text, "MAIL_PORT=2525") {
		t.Fatalf("MergeEnv left the old value:\n%s", text)
	}
	if got := strings.Count(text, envStart); got != 1 {
		t.Fatalf("devenv block appears %d times:\n%s", got, text)
	}
	if _, err := os.Stat(filepath.Join(root, ".env.devenv.bak")); err != nil {
		t.Fatalf("missing backup: %v", err)
	}
}

func TestMergeEnvCreatesBlockWithoutFile(t *testing.T) {
	root := t.TempDir()
	m := &Manager{}
	if err := m.MergeEnv(root, map[string]string{"MAIL_PORT": "2525"}); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(root, ".env"))
	if err != nil {
		t.Fatal(err)
	}
	text := string(data)
	if !strings.Contains(text, envStart) || !strings.Contains(text, envEnd) {
		t.Fatalf("missing devenv block:\n%s", text)
	}
	if !strings.Contains(text, "MAIL_PORT=2525") {
		t.Fatalf("missing merged value:\n%s", text)
	}
}
