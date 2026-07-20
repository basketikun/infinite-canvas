package handler

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/timerainv7/infinite-canvas/server/service"
)

type saveCanvasProjectRequest struct {
	Title   string          `json:"title"`
	Payload json.RawMessage `json:"payload"`
}

func CanvasProjects(w http.ResponseWriter, r *http.Request) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	projects, err := service.ListCanvasProjects(user.ID)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, projects)
}

func CanvasProject(w http.ResponseWriter, r *http.Request, id string) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	project, found, err := service.CurrentCanvasProject(user.ID, id)
	if err != nil {
		FailError(w, err)
		return
	}
	if !found {
		writeJSONStatus(w, http.StatusNotFound, response{Code: 1, Data: nil, Msg: "画布不存在"})
		return
	}
	w.Header().Set("ETag", strconv.FormatInt(project.CurrentRevision, 10))
	OK(w, project)
}

func SaveCanvasProject(w http.ResponseWriter, r *http.Request, id string) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	expectedRevision, err := parseIfMatch(r.Header.Get("If-Match"))
	if err != nil {
		writeJSONStatus(w, http.StatusPreconditionRequired, response{Code: 1, Data: nil, Msg: "请提供 If-Match 修订号"})
		return
	}
	request := saveCanvasProjectRequest{}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		Fail(w, "画布数据格式不正确")
		return
	}
	project, err := service.SaveCanvasProject(user.ID, id, request.Title, request.Payload, expectedRevision)
	if conflict, ok := service.CanvasRevisionConflict(err); ok {
		writeJSONStatus(w, http.StatusConflict, response{Code: 1, Data: map[string]int64{"currentRevision": conflict.CurrentRevision}, Msg: "画布已在其他设备更新"})
		return
	}
	if err != nil {
		FailError(w, err)
		return
	}
	w.Header().Set("ETag", strconv.FormatInt(project.CurrentRevision, 10))
	OK(w, project)
}

func UploadCanvasMedia(w http.ResponseWriter, r *http.Request) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 100<<20)
	if err := r.ParseMultipartForm(100 << 20); err != nil {
		Fail(w, "媒体文件无效或超过 100MB")
		return
	}
	defer r.MultipartForm.RemoveAll()
	file, header, err := r.FormFile("file")
	if err != nil {
		Fail(w, "请上传媒体文件")
		return
	}
	defer file.Close()
	media, err := service.UploadCanvasMedia(r.Context(), user.ID, r.FormValue("key"), header.Header.Get("Content-Type"), file)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, media)
}

func CanvasMedia(w http.ResponseWriter, r *http.Request, key string) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	media, found, err := service.DownloadCanvasMedia(r.Context(), user.ID, key)
	if err != nil {
		FailError(w, err)
		return
	}
	if !found {
		writeJSONStatus(w, http.StatusNotFound, response{Code: 1, Data: nil, Msg: "媒体不存在"})
		return
	}
	defer media.Close()
	w.Header().Set("Content-Type", media.MimeType)
	w.Header().Set("Content-Length", strconv.FormatInt(media.Bytes, 10))
	_, _ = io.Copy(w, media)
}

func parseIfMatch(value string) (int64, error) {
	return strconv.ParseInt(strings.Trim(strings.TrimSpace(value), "\""), 10, 64)
}

func writeJSONStatus(w http.ResponseWriter, status int, value response) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
