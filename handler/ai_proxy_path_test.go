package handler

import "testing"

func TestResolveAIProxyPathRoutesArkSeedanceToContentGeneration(t *testing.T) {
	got := resolveAIProxyPath("https://ark.cn-beijing.volces.com/api/v3", "doubao-seedance-2-0-260128", "/videos")
	if got != "/contents/generations/tasks" {
		t.Fatalf("path = %q", got)
	}
}

func TestResolveAIProxyPathKeepsNonSeedanceVideoPath(t *testing.T) {
	got := resolveAIProxyPath("https://ark.cn-beijing.volces.com/api/v3", "grok-imagine-video", "/videos")
	if got != "/videos" {
		t.Fatalf("path = %q", got)
	}
}
