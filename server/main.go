package main

import (
	"log"

	"github.com/timerainv7/infinite-canvas/server/config"
	"github.com/timerainv7/infinite-canvas/server/router"
	"github.com/timerainv7/infinite-canvas/server/service"
)

func main() {
	if err := config.Load(); err != nil {
		log.Fatal(err)
	}
	if err := service.EnsureDefaultAdmin(); err != nil {
		log.Fatal(err)
	}
	service.StartPromptSyncScheduler()
	log.Fatal(router.New().Run(":" + config.Cfg.Port))
}
