package service

import (
	"sync"
	"time"
)

// chatRateLimit 单实例内的聊天接口限流：每个用户 60s 内最多 ChatRateLimitMax 次。
const (
	ChatRateLimitMax    = 5
	ChatRateLimitWindow = time.Minute
)

type rateBucket struct {
	timestamps []time.Time
}

var (
	chatBucketsMu sync.Mutex
	chatBuckets   = map[string]*rateBucket{}
)

// AllowChat 检查并记录一次用户的聊天调用，超过窗口配额返回 false 与下一次可用时间。
func AllowChat(userID string) (bool, time.Duration) {
	if userID == "" {
		return true, 0
	}
	chatBucketsMu.Lock()
	defer chatBucketsMu.Unlock()
	now := time.Now()
	bucket, ok := chatBuckets[userID]
	if !ok {
		bucket = &rateBucket{}
		chatBuckets[userID] = bucket
	}
	cutoff := now.Add(-ChatRateLimitWindow)
	kept := bucket.timestamps[:0]
	for _, ts := range bucket.timestamps {
		if ts.After(cutoff) {
			kept = append(kept, ts)
		}
	}
	bucket.timestamps = kept
	if len(bucket.timestamps) >= ChatRateLimitMax {
		retry := bucket.timestamps[0].Add(ChatRateLimitWindow).Sub(now)
		if retry < 0 {
			retry = 0
		}
		return false, retry
	}
	bucket.timestamps = append(bucket.timestamps, now)
	return true, 0
}
