package main

import (
	"log"
	"os"

	"github.com/basketikun/infinite-canvas/config"
	"github.com/basketikun/infinite-canvas/router"
	"github.com/basketikun/infinite-canvas/service"
)

func main() {
	if err := config.Load(); err != nil {
		log.Fatal(err)
	}
	if err := os.MkdirAll(config.Cfg.ImageDir, 0o755); err != nil {
		log.Fatal(err)
	}
	if err := service.EnsureDefaultAdmin(); err != nil {
		log.Fatal(err)
	}
	log.Fatal(router.New().Run(":" + config.Cfg.Port))
}
