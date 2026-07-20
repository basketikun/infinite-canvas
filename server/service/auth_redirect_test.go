package service

import (
	"encoding/base64"
	"testing"
)

func TestSafeRedirectPath(t *testing.T) {
	cases := map[string]string{
		"/":                    "/",
		"/canvas/abc":          "/canvas/abc",
		"/login?redirect=/x":   "/login?redirect=/x",
		"":                     "/",
		"//evil.com":           "/",
		"/\\evil.com":          "/",
		"https://evil.com":     "/",
		"http://evil.com":      "/",
		"javascript:alert(1)":  "/",
		"evil.com":             "/",
		"/\t/evil.com":         "/", // browsers strip the tab → //evil.com
		"/normal\tpath":        "/normalpath",
	}
	for in, want := range cases {
		if got := safeRedirectPath(in); got != want {
			t.Errorf("safeRedirectPath(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestDecodeStateRejectsOpenRedirect(t *testing.T) {
	for _, in := range []string{"//evil.com", "/\\evil.com", "https://evil.com"} {
		state := base64.RawURLEncoding.EncodeToString([]byte(in))
		if got := decodeState(state); got != "/" {
			t.Errorf("decodeState(state(%q)) = %q, want \"/\"", in, got)
		}
	}
	state := base64.RawURLEncoding.EncodeToString([]byte("/canvas/1"))
	if got := decodeState(state); got != "/canvas/1" {
		t.Errorf("decodeState(state(/canvas/1)) = %q, want /canvas/1", got)
	}
}
