package service

import (
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/basketikun/infinite-canvas/model"
)

func TestFetchAdminChannelModelsParsesOpenAIModels(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":"z-model"},{"id":"a-model"},{"id":""}]}`))
	}))
	defer server.Close()

	models, err := fetchAdminChannelModels(model.ModelChannel{
		BaseURL: server.URL,
		APIKey:  "test-key",
	})
	if err != nil {
		t.Fatalf("fetchAdminChannelModels returned error: %v", err)
	}
	if want := []string{"a-model", "z-model"}; !reflect.DeepEqual(models, want) {
		t.Fatalf("models = %#v, want %#v", models, want)
	}
}

func TestFetchAdminChannelModelsReportsArkPlanModelsUnsupported(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/plan/v3/models" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	_, err := fetchAdminChannelModels(model.ModelChannel{
		BaseURL: server.URL + "/api/plan/v3/contents/generations/tasks",
		APIKey:  "test-key",
	})
	if err == nil {
		t.Fatal("expected unsupported /models error")
	}
	if !strings.Contains(err.Error(), "Agent Plan 未提供 OpenAI /models") {
		t.Fatalf("error = %q", err.Error())
	}
}

func TestBuildModelChannelURLNormalizesArkPlanTaskPath(t *testing.T) {
	got := BuildModelChannelURL(model.ModelChannel{BaseURL: "https://ark.cn-beijing.volces.com/api/plan/v3/contents/generations/tasks?debug=1"}, "/models")
	want := "https://ark.cn-beijing.volces.com/api/plan/v3/models"
	if got != want {
		t.Fatalf("BuildModelChannelURL = %q, want %q", got, want)
	}
}

func TestNormalizeSettingsPublishesEnabledChannelModelsAndRepairsDefaults(t *testing.T) {
	settings := normalizeSettings(model.Settings{
		Public: model.PublicSetting{
			ModelChannel: model.PublicModelChannelSetting{
				AvailableModels:   []string{"grok-imagine-video", "disabled-model"},
				DefaultModel:      "grok-imagine-video",
				DefaultTextModel:  "missing-text",
				DefaultImageModel: "missing-image",
				DefaultVideoModel: "missing-video",
				ModelCosts:        []model.ModelCost{{Model: "doubao-seedream-5.0-lite", Credits: 8}},
			},
		},
		Private: model.PrivateSetting{
			Channels: []model.ModelChannel{
				{Name: "主渠道", Enabled: true, Models: []string{"gpt-5.5", "doubao-seedream-5.0-lite", "doubao-seedance-2.0-fast", "gpt-5.5"}},
				{Enabled: false, Models: []string{"disabled-model"}},
			},
		},
	})

	channel := settings.Public.ModelChannel
	wantModels := []string{"gpt-5.5 - 主渠道", "doubao-seedream-5.0-lite - 主渠道", "doubao-seedance-2.0-fast - 主渠道"}
	if !reflect.DeepEqual(channel.AvailableModels, wantModels) {
		t.Fatalf("available models = %#v, want %#v", channel.AvailableModels, wantModels)
	}
	if channel.DefaultModel != "gpt-5.5 - 主渠道" {
		t.Fatalf("default model = %q, want text model", channel.DefaultModel)
	}
	if channel.DefaultTextModel != "gpt-5.5 - 主渠道" {
		t.Fatalf("default text model = %q, want text model", channel.DefaultTextModel)
	}
	if channel.DefaultImageModel != "doubao-seedream-5.0-lite - 主渠道" {
		t.Fatalf("default image model = %q, want seedream", channel.DefaultImageModel)
	}
	if channel.DefaultVideoModel != "doubao-seedance-2.0-fast - 主渠道" {
		t.Fatalf("default video model = %q, want seedance", channel.DefaultVideoModel)
	}
	if got := channel.ModelCosts[1]; got.Model != "doubao-seedream-5.0-lite - 主渠道" || got.Credits != 8 {
		t.Fatalf("image model cost = %#v, want migrated raw model cost", got)
	}
}

func TestNormalizeSettingsKeepsDuplicateChannelModelAliasesSeparate(t *testing.T) {
	settings := normalizeSettings(model.Settings{
		Public: model.PublicSetting{
			ModelChannel: model.PublicModelChannelSetting{
				ModelCosts: []model.ModelCost{
					{Model: "gpt-image-2", Credits: 3},
					{Model: "gpt-image-2 - 慢速", Credits: 7},
				},
			},
		},
		Private: model.PrivateSetting{
			Channels: []model.ModelChannel{
				{Name: "快速", Enabled: true, Models: []string{"gpt-image-2"}},
				{Name: "慢速", Enabled: true, Models: []string{"gpt-image-2"}},
			},
		},
	})

	channel := settings.Public.ModelChannel
	wantModels := []string{"gpt-image-2 - 快速", "gpt-image-2 - 慢速"}
	if !reflect.DeepEqual(channel.AvailableModels, wantModels) {
		t.Fatalf("available models = %#v, want %#v", channel.AvailableModels, wantModels)
	}
	wantCosts := []model.ModelCost{
		{Model: "gpt-image-2 - 快速", Credits: 3},
		{Model: "gpt-image-2 - 慢速", Credits: 7},
	}
	if !reflect.DeepEqual(channel.ModelCosts, wantCosts) {
		t.Fatalf("model costs = %#v, want %#v", channel.ModelCosts, wantCosts)
	}
}

func TestResolveModelChannelAliasUsesNamedChannelAndRawModel(t *testing.T) {
	channels := []model.ModelChannel{
		{Name: "渠道A", Enabled: true, BaseURL: "https://a.example.com", APIKey: "a-key", Models: []string{"gpt-image-2"}},
		{Name: "渠道B", Enabled: true, BaseURL: "https://b.example.com", APIKey: "b-key", Models: []string{"gpt-image-2"}},
	}

	resolved, err := resolveModelChannel(channels, "gpt-image-2 - 渠道B")
	if err != nil {
		t.Fatalf("resolveModelChannel returned error: %v", err)
	}
	if resolved.RawModelName != "gpt-image-2" {
		t.Fatalf("raw model = %q, want gpt-image-2", resolved.RawModelName)
	}
	if resolved.Channel.Name != "渠道B" {
		t.Fatalf("channel = %q, want 渠道B", resolved.Channel.Name)
	}
}
