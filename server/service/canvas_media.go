package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/url"
	"strings"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"github.com/timerainv7/infinite-canvas/server/config"
	"github.com/timerainv7/infinite-canvas/server/model"
	"github.com/timerainv7/infinite-canvas/server/repository"
)

const maxCanvasMediaBytes = 100 << 20

type CanvasMediaReader struct {
	io.ReadCloser
	MimeType string
	Bytes    int64
}

func UploadCanvasMedia(ctx context.Context, userID string, key string, mimeType string, source io.Reader) (model.MediaObject, error) {
	key = strings.TrimSpace(key)
	if userID == "" || key == "" || source == nil {
		return model.MediaObject{}, safeMessageError{message: "媒体参数不完整"}
	}
	data, err := io.ReadAll(io.LimitReader(source, maxCanvasMediaBytes+1))
	if err != nil || len(data) == 0 || len(data) > maxCanvasMediaBytes {
		return model.MediaObject{}, safeMessageError{message: "媒体文件无效或超过 100MB"}
	}
	store, err := newCanvasObjectStore()
	if err != nil {
		return model.MediaObject{}, err
	}
	digest := sha256.Sum256(data)
	objectName := canvasObjectName(userID, key)
	if err := store.Put(ctx, objectName, data, mimeType); err != nil {
		return model.MediaObject{}, err
	}
	return repository.SaveMediaObject(model.MediaObject{UserID: userID, Key: key, SHA256: hex.EncodeToString(digest[:]), Bytes: int64(len(data)), MimeType: firstCanvasMediaMimeType(mimeType), CreatedAt: now()})
}

func DownloadCanvasMedia(ctx context.Context, userID string, key string) (CanvasMediaReader, bool, error) {
	media, found, err := repository.GetMediaObject(userID, key)
	if err != nil || !found {
		return CanvasMediaReader{}, found, err
	}
	store, err := newCanvasObjectStore()
	if err != nil {
		return CanvasMediaReader{}, false, err
	}
	reader, err := store.Get(ctx, canvasObjectName(userID, key))
	if err != nil {
		return CanvasMediaReader{}, false, err
	}
	return CanvasMediaReader{ReadCloser: reader, MimeType: media.MimeType, Bytes: media.Bytes}, true, nil
}

type canvasObjectStore struct {
	client *minio.Client
	bucket string
}

func newCanvasObjectStore() (canvasObjectStore, error) {
	endpoint := strings.TrimSpace(config.Cfg.SyncS3Endpoint)
	if endpoint == "" || strings.TrimSpace(config.Cfg.SyncS3AccessKey) == "" || strings.TrimSpace(config.Cfg.SyncS3SecretKey) == "" {
		return canvasObjectStore{}, safeMessageError{message: "未配置云同步对象存储"}
	}
	parsed, err := url.Parse(endpoint)
	if err != nil {
		return canvasObjectStore{}, err
	}
	host := parsed.Host
	if host == "" {
		host = parsed.Path
	}
	client, err := minio.New(host, &minio.Options{Creds: credentials.NewStaticV4(config.Cfg.SyncS3AccessKey, config.Cfg.SyncS3SecretKey, ""), Secure: parsed.Scheme == "https"})
	if err != nil {
		return canvasObjectStore{}, err
	}
	store := canvasObjectStore{client: client, bucket: config.Cfg.SyncS3Bucket}
	if err := store.ensureBucket(context.Background()); err != nil {
		return canvasObjectStore{}, err
	}
	return store, nil
}

func (store canvasObjectStore) ensureBucket(ctx context.Context) error {
	exists, err := store.client.BucketExists(ctx, store.bucket)
	if err != nil || exists {
		return err
	}
	return store.client.MakeBucket(ctx, store.bucket, minio.MakeBucketOptions{})
}

func (store canvasObjectStore) Put(ctx context.Context, objectName string, data []byte, mimeType string) error {
	_, err := store.client.PutObject(ctx, store.bucket, objectName, bytes.NewReader(data), int64(len(data)), minio.PutObjectOptions{ContentType: firstCanvasMediaMimeType(mimeType)})
	return err
}

func (store canvasObjectStore) Get(ctx context.Context, objectName string) (io.ReadCloser, error) {
	object, err := store.client.GetObject(ctx, store.bucket, objectName, minio.GetObjectOptions{})
	if err != nil {
		return nil, err
	}
	if _, err := object.Stat(); err != nil {
		_ = object.Close()
		return nil, err
	}
	return object, nil
}

func canvasObjectName(userID string, key string) string {
	digest := sha256.Sum256([]byte(key))
	return fmt.Sprintf("canvas/%s/%x", userID, digest[:])
}

func firstCanvasMediaMimeType(value string) string {
	if strings.TrimSpace(value) == "" {
		return "application/octet-stream"
	}
	return strings.Split(value, ";")[0]
}
