package repository

import (
	"errors"
	"fmt"

	"github.com/timerainv7/infinite-canvas/server/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// CanvasRevisionConflictError 表示客户端写入时持有的版本已过期。
type CanvasRevisionConflictError struct {
	CurrentRevision int64
}

func (err *CanvasRevisionConflictError) Error() string {
	return fmt.Sprintf("画布已更新，当前版本为 %d", err.CurrentRevision)
}

// SaveCanvasProject 使用 compare-and-swap 保存一个新修订。新建项目的 expectedRevision 必须为 0。
func SaveCanvasProject(userID string, projectID string, title string, payload string, expectedRevision int64, now string) (model.CanvasProject, error) {
	database, err := DB()
	if err != nil {
		return model.CanvasProject{}, err
	}
	result := model.CanvasProject{}
	err = database.Transaction(func(tx *gorm.DB) error {
		project := model.CanvasProject{}
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ? AND id = ?", userID, projectID).First(&project).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			if expectedRevision != 0 {
				return &CanvasRevisionConflictError{}
			}
			project = model.CanvasProject{ID: projectID, UserID: userID, Title: title, CurrentRevision: 1, CreatedAt: now, UpdatedAt: now}
			if err := tx.Create(&project).Error; err != nil {
				return err
			}
		} else if err != nil {
			return err
		} else {
			if project.CurrentRevision != expectedRevision {
				return &CanvasRevisionConflictError{CurrentRevision: project.CurrentRevision}
			}
			project.Title, project.CurrentRevision, project.UpdatedAt = title, project.CurrentRevision+1, now
			if err := tx.Save(&project).Error; err != nil {
				return err
			}
		}
		if err := tx.Create(&model.CanvasRevision{ProjectID: project.ID, Revision: project.CurrentRevision, Payload: payload, CreatedAt: now}).Error; err != nil {
			return err
		}
		result = project
		return nil
	})
	return result, err
}

// GetCanvasProject 只返回当前用户拥有的项目，避免通过项目 ID 越权读取元数据。
func GetCanvasProject(userID string, projectID string) (model.CanvasProject, bool, error) {
	database, err := DB()
	if err != nil {
		return model.CanvasProject{}, false, err
	}
	project := model.CanvasProject{}
	err = database.Where("user_id = ? AND id = ?", userID, projectID).First(&project).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.CanvasProject{}, false, nil
	}
	return project, err == nil, err
}

// GetCurrentCanvasProject 返回当前用户项目及其当前不可变快照。
func GetCurrentCanvasProject(userID string, projectID string) (model.CanvasProject, model.CanvasRevision, bool, error) {
	project, found, err := GetCanvasProject(userID, projectID)
	if err != nil || !found {
		return project, model.CanvasRevision{}, found, err
	}
	database, err := DB()
	if err != nil {
		return model.CanvasProject{}, model.CanvasRevision{}, false, err
	}
	revision := model.CanvasRevision{}
	err = database.Where("project_id = ? AND revision = ?", project.ID, project.CurrentRevision).First(&revision).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return project, model.CanvasRevision{}, false, nil
	}
	return project, revision, err == nil, err
}
