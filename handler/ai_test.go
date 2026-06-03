package handler

import (
	"bytes"
	"encoding/json"
	"io"
	"mime"
	"mime/multipart"
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
	if !strings.Contains(got, "参考视频疑似包含真人") || !strings.Contains(got, "asset://") {
		t.Fatalf("detail = %q", got)
	}
}

func TestSafeUpstreamTextTruncates(t *testing.T) {
	got := safeUpstreamText(strings.Repeat("错", 320))
	if len([]rune(got)) != 303 {
		t.Fatalf("truncated rune length = %d", len([]rune(got)))
	}
}

func TestRewriteAIRequestModelJSON(t *testing.T) {
	body, contentType, err := rewriteAIRequestModel([]byte(`{"model":"gpt-image-2 - 渠道A","prompt":"hi"}`), "application/json", "gpt-image-2")
	if err != nil {
		t.Fatalf("rewriteAIRequestModel returned error: %v", err)
	}
	if contentType != "application/json" {
		t.Fatalf("content type = %q, want application/json", contentType)
	}
	var payload struct {
		Model  string `json:"model"`
		Prompt string `json:"prompt"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatalf("rewritten body is invalid json: %v", err)
	}
	if payload.Model != "gpt-image-2" || payload.Prompt != "hi" {
		t.Fatalf("payload = %#v, want raw model and preserved prompt", payload)
	}
}

func TestRewriteAIRequestModelMultipart(t *testing.T) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	_ = writer.WriteField("model", "gpt-image-2 - 渠道A")
	_ = writer.WriteField("prompt", "hi")
	part, err := writer.CreateFormFile("image", "test.png")
	if err != nil {
		t.Fatalf("CreateFormFile returned error: %v", err)
	}
	_, _ = part.Write([]byte("image-bytes"))
	if err := writer.Close(); err != nil {
		t.Fatalf("Close returned error: %v", err)
	}

	nextBody, contentType, err := rewriteAIRequestModel(body.Bytes(), writer.FormDataContentType(), "gpt-image-2")
	if err != nil {
		t.Fatalf("rewriteAIRequestModel returned error: %v", err)
	}
	_, params, err := mime.ParseMediaType(contentType)
	if err != nil {
		t.Fatalf("rewritten content type is invalid: %v", err)
	}
	form, err := multipart.NewReader(bytes.NewReader(nextBody), params["boundary"]).ReadForm(32 << 20)
	if err != nil {
		t.Fatalf("rewritten multipart is invalid: %v", err)
	}
	defer form.RemoveAll()
	if got := form.Value["model"][0]; got != "gpt-image-2" {
		t.Fatalf("model = %q, want gpt-image-2", got)
	}
	if got := form.Value["prompt"][0]; got != "hi" {
		t.Fatalf("prompt = %q, want hi", got)
	}
	file, err := form.File["image"][0].Open()
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer file.Close()
	fileBody, _ := io.ReadAll(file)
	if string(fileBody) != "image-bytes" {
		t.Fatalf("file body = %q, want image-bytes", string(fileBody))
	}
}
