package service

import (
	"encoding/json"
	"errors"
	"strings"

	"github.com/timerainv7/infinite-canvas/server/model"
	"github.com/timerainv7/infinite-canvas/server/repository"
)

type CanvasProjectSnapshot struct {
	model.CanvasProject
	Payload json.RawMessage `json:"payload"`
}

func ListCanvasProjects(userID string) ([]model.CanvasProject, error) {
	return repository.ListCanvasProjects(userID)
}

func CurrentCanvasProject(userID string, projectID string) (CanvasProjectSnapshot, bool, error) {
	project, revision, found, err := repository.GetCurrentCanvasProject(userID, projectID)
	if err != nil || !found {
		return CanvasProjectSnapshot{}, found, err
	}
	return CanvasProjectSnapshot{CanvasProject: project, Payload: json.RawMessage(revision.Payload)}, true, nil
}

func SaveCanvasProject(userID string, projectID string, title string, payload json.RawMessage, expectedRevision int64) (CanvasProjectSnapshot, error) {
	if strings.TrimSpace(projectID) == "" || !json.Valid(payload) {
		return CanvasProjectSnapshot{}, safeMessageError{message: "画布数据格式不正确"}
	}
	project, err := repository.SaveCanvasProject(userID, projectID, strings.TrimSpace(title), string(payload), expectedRevision, now())
	if err != nil {
		return CanvasProjectSnapshot{}, err
	}
	return CanvasProjectSnapshot{CanvasProject: project, Payload: payload}, nil
}

func CanvasRevisionConflict(err error) (*repository.CanvasRevisionConflictError, bool) {
	var conflict *repository.CanvasRevisionConflictError
	return conflict, errors.As(err, &conflict)
}
