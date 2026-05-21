package repository

import (
	"errors"

	"github.com/basketikun/infinite-canvas/model"
	"gorm.io/gorm"
)

func SaveImage(item model.Image) (model.Image, error) {
	db, err := DB()
	if err != nil {
		return item, err
	}
	return item, db.Save(&item).Error
}

func GetImageByID(id string) (model.Image, bool, error) {
	db, err := DB()
	if err != nil {
		return model.Image{}, false, err
	}
	var image model.Image
	if err := db.Where("id = ?", id).First(&image).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return model.Image{}, false, nil
		}
		return model.Image{}, false, err
	}
	return image, true, nil
}

func DeleteImage(id string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Where("id = ?", id).Delete(&model.Image{}).Error
}
