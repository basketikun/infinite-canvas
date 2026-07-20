package repository

import (
	"errors"
	"sync"
	"testing"

	"github.com/timerainv7/infinite-canvas/server/config"
)

func TestSaveCanvasProjectRejectsStaleRevision(t *testing.T) {
	previousConfig, previousDB, previousOnce, previousErr := config.Cfg, db, dbOnce, dbErr
	t.Cleanup(func() {
		config.Cfg, db, dbOnce, dbErr = previousConfig, previousDB, previousOnce, previousErr
	})
	config.Cfg = config.Config{StorageDriver: "sqlite", DatabaseDSN: ":memory:"}
	db, dbOnce, dbErr = nil, sync.Once{}, nil

	created, err := SaveCanvasProject("user-1", "project-1", "第一版", `{"nodes":[]}`, 0, "2026-07-20T00:00:00Z")
	if err != nil {
		t.Fatalf("create project: %v", err)
	}
	if created.CurrentRevision != 1 {
		t.Fatalf("created revision = %d, want 1", created.CurrentRevision)
	}

	_, err = SaveCanvasProject("user-1", "project-1", "过期写入", `{"nodes":[1]}`, 0, "2026-07-20T00:01:00Z")
	var conflict *CanvasRevisionConflictError
	if !errors.As(err, &conflict) || conflict.CurrentRevision != 1 {
		t.Fatalf("stale write error = %#v, want current revision 1 conflict", err)
	}

	updated, err := SaveCanvasProject("user-1", "project-1", "第二版", `{"nodes":[2]}`, 1, "2026-07-20T00:02:00Z")
	if err != nil {
		t.Fatalf("update project: %v", err)
	}
	if updated.CurrentRevision != 2 {
		t.Fatalf("updated revision = %d, want 2", updated.CurrentRevision)
	}
	current, revision, found, err := GetCurrentCanvasProject("user-1", "project-1")
	if err != nil || !found {
		t.Fatalf("current project = found:%v err:%v, want current revision", found, err)
	}
	if current.CurrentRevision != 2 || revision.Payload != `{"nodes":[2]}` {
		t.Fatalf("current project = revision:%d payload:%s", current.CurrentRevision, revision.Payload)
	}
}

func TestCanvasProjectsAreScopedToUser(t *testing.T) {
	previousConfig, previousDB, previousOnce, previousErr := config.Cfg, db, dbOnce, dbErr
	t.Cleanup(func() {
		config.Cfg, db, dbOnce, dbErr = previousConfig, previousDB, previousOnce, previousErr
	})
	config.Cfg = config.Config{StorageDriver: "sqlite", DatabaseDSN: ":memory:"}
	db, dbOnce, dbErr = nil, sync.Once{}, nil

	if _, err := SaveCanvasProject("user-1", "project-1", "私有画布", `{}`, 0, "2026-07-20T00:00:00Z"); err != nil {
		t.Fatalf("create project: %v", err)
	}
	if _, found, err := GetCanvasProject("user-2", "project-1"); err != nil || found {
		t.Fatalf("other user project = found:%v err:%v, want not found", found, err)
	}
}
