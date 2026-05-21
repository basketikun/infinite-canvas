package repository

import (
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/basketikun/infinite-canvas/config"
	"github.com/basketikun/infinite-canvas/model"
	"github.com/glebarez/sqlite"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

var promptCategories = []model.PromptCategory{
	{Category: "system", Name: "系统", Description: "系统提示词分类"},
	{Category: "gpt-image-2-prompts", Name: "GPT Image 2 Prompts", Description: "EvoLinkAI 的 GPT Image 2 案例提示词分类", GithubURL: "https://github.com/EvoLinkAI/awesome-gpt-image-2-API-and-Prompts", Remote: true},
	{Category: "awesome-gpt-image", Name: "Awesome GPT Image", Description: "ZeroLu 的中文 GPT Image 提示词分类", GithubURL: "https://github.com/ZeroLu/awesome-gpt-image", Remote: true},
	{Category: "awesome-gpt4o-image-prompts", Name: "Awesome GPT4o Image Prompts", Description: "ImgEdify 的 GPT-4o 图像提示词分类", GithubURL: "https://github.com/ImgEdify/Awesome-GPT4o-Image-Prompts", Remote: true},
	{Category: "youmind-gpt-image-2", Name: "YouMind GPT Image 2", Description: "YouMind OpenLab 的 GPT Image 2 中文提示词分类", GithubURL: "https://github.com/YouMind-OpenLab/awesome-gpt-image-2", Remote: true},
	{Category: "youmind-nano-banana-pro", Name: "YouMind Nano Banana Pro", Description: "YouMind OpenLab 的 Nano Banana Pro 中文提示词分类", GithubURL: "https://github.com/YouMind-OpenLab/awesome-nano-banana-pro-prompts", Remote: true},
}

var (
	db     *gorm.DB
	dbOnce sync.Once
	dbErr  error
)

// DB 初始化并返回全局数据库连接。
func DB() (*gorm.DB, error) {
	dbOnce.Do(func() {
		driver := strings.ToLower(strings.TrimSpace(config.Cfg.StorageDriver))
		if driver == "" {
			driver = "sqlite"
		}
		dsn := config.Cfg.DatabaseDSN
		if driver == "sqlite" && dsn != ":memory:" {
			_ = os.MkdirAll(filepath.Dir(dsn), 0755)
		}
		db, dbErr = gorm.Open(dialector(driver, dsn), &gorm.Config{})
		if dbErr != nil {
			return
		}
		dbErr = db.AutoMigrate(
			&model.User{},
			&model.Prompt{},
			&model.Asset{},
			&model.AIConfig{},
			&model.Canvas{},
			&model.Generation{},
			&model.CreditLog{},
			&model.Image{},
		)
	})
	return db, dbErr
}

func dialector(driver string, dsn string) gorm.Dialector {
	switch driver {
	case "mysql":
		return mysql.Open(dsn)
	case "postgres", "postgresql":
		return postgres.Open(dsn)
	default:
		return sqlite.Open(dsn)
	}
}
