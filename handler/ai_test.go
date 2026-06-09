package handler

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func TestAIUpstreamErrorDetail(t *testing.T) {
	got := aiUpstreamErrorDetail([]byte(`{"error":{"code":"InvalidParameter","message":"reference video fps is invalid"}}`))
	if got != "InvalidParameter reference video fps is invalid" {
		t.Fatalf("detail = %q", got)
	}
}

func TestAIUpstreamErrorDetailExplainsSensitiveVideo(t *testing.T) {
	got := aiUpstreamErrorDetail([]byte(`{"error":{"code":"InputVideoSensitiveContentDetected.PrivacyInformation","message":"The request failed because the input video may contain real person."}}`))
	if !strings.Contains(got, "asset://") {
		t.Fatalf("detail = %q", got)
	}
}

func TestSafeUpstreamTextTruncates(t *testing.T) {
	got := safeUpstreamText(strings.Repeat("x", 320))
	if len([]rune(got)) != 303 {
		t.Fatalf("truncated rune length = %d", len([]rune(got)))
	}
}

func TestBuildGenerationsVideoBody(t *testing.T) {
	body, err := buildGenerationsVideoBody([]byte(`{
		"model":"seedance-2.0",
		"content":[
			{"type":"text","text":"a cat walking in a garden"},
			{"type":"image_url","image_url":{"url":"https://example.com/ref-1.jpg"},"role":"reference_image"},
			{"type":"video_url","video_url":{"url":"https://example.com/ref.mp4"},"role":"reference_video"},
			{"type":"audio_url","audio_url":{"url":"https://example.com/ref.mp3"},"role":"reference_audio"}
		],
		"ratio":"1:1",
		"duration":4,
		"resolution":"480p",
		"generate_audio":true,
		"watermark":false
	}`))
	if err != nil {
		t.Fatalf("buildGenerationsVideoBody returned error: %v", err)
	}
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatalf("generated body is invalid JSON: %v", err)
	}
	if payload["model_id"] != "seedance-2.0" || payload["type"] != "video" || payload["prompt"] != "a cat walking in a garden" {
		t.Fatalf("unexpected payload basics: %#v", payload)
	}
	params, ok := payload["params"].(map[string]any)
	if !ok {
		t.Fatalf("params missing: %#v", payload)
	}
	if params["aspectRatio"] != "1:1" || params["resolution"] != "480p" || params["mode"] != "references" {
		t.Fatalf("unexpected params: %#v", params)
	}
	if params["duration"] != float64(4) {
		t.Fatalf("duration = %#v, want 4", params["duration"])
	}
	if params["generateAudio"] != true || params["watermark"] != false {
		t.Fatalf("unexpected audio/watermark params: %#v", params)
	}
	if !reflect.DeepEqual(params["imageUrls"], []any{"https://example.com/ref-1.jpg"}) {
		t.Fatalf("imageUrls = %#v", params["imageUrls"])
	}
	if !reflect.DeepEqual(params["videoUrls"], []any{"https://example.com/ref.mp4"}) {
		t.Fatalf("videoUrls = %#v", params["videoUrls"])
	}
	if !reflect.DeepEqual(params["audioUrls"], []any{"https://example.com/ref.mp3"}) {
		t.Fatalf("audioUrls = %#v", params["audioUrls"])
	}
}
