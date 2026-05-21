package config

import (
	"github.com/caarlos0/env/v11"
	"github.com/joho/godotenv"
)

type Config struct {
	Port           string `env:"PORT" envDefault:"8080"`
	AdminUsername  string `env:"ADMIN_USERNAME" envDefault:"admin"`
	AdminPassword  string `env:"ADMIN_PASSWORD" envDefault:"infinite-canvas"`
	JWTSecret      string `env:"JWT_SECRET" envDefault:"infinite-canvas"`
	JWTExpireHours int    `env:"JWT_EXPIRE_HOURS" envDefault:"168"`
	StorageDriver  string `env:"STORAGE_DRIVER" envDefault:"sqlite"`
	DatabaseDSN    string `env:"DATABASE_DSN" envDefault:"data/infinite-canvas.db"`
	ImageDir       string `env:"IMAGE_DIR" envDefault:"data/uploads"`
}

var Cfg Config

func Load() error {
	_ = godotenv.Load()
	return env.Parse(&Cfg)
}
