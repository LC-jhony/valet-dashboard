package project

import "testing"

func TestDomainFromName(t *testing.T) {
	cases := []struct {
		name string
		tld  string
		want string
	}{
		{"my-app", "test", "my-app.test"},
		{"Admin.Example.com", "test", "admin-example.test"},
		{"v1.2", "test", "v1-2.test"},
		{"foo_bar", "test", "foo-bar.test"},
		{"  Foo  Bar  ", "test", "foo-bar.test"},
		{"shop", "localhost", "shop.localhost"},
	}
	for _, tc := range cases {
		if got := DomainFromName(tc.name, tc.tld); got != tc.want {
			t.Errorf("DomainFromName(%q, %q) = %q, want %q", tc.name, tc.tld, got, tc.want)
		}
	}
}

func TestNormalizeExplicitDomain(t *testing.T) {
	got, err := NormalizeExplicitDomain("Shop.Test", "test")
	if err != nil || got != "shop.test" {
		t.Fatalf("got %q, err %v", got, err)
	}
	got, err = NormalizeExplicitDomain("shop", "test")
	if err != nil || got != "shop.test" {
		t.Fatalf("got %q, err %v", got, err)
	}
	for _, bad := range []string{"", "http://foo.test", "foo.test/path", "foo:8080", "foo_bar.test", "-foo.test"} {
		if _, err := NormalizeExplicitDomain(bad, "test"); err == nil {
			t.Errorf("expected error for %q", bad)
		}
	}
}

func TestSanitizeName(t *testing.T) {
	if got := SanitizeName("  My_Project!! "); got != "my-project" {
		t.Fatalf("got %q", got)
	}
	if got := SanitizeName("..."); got != "site" {
		t.Fatalf("got %q", got)
	}
}
