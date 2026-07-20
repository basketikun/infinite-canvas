package model

const MaxPageSize = 500

// Query 列表筛选和分页参数。
type Query struct {
	Keyword  string
	Tags     []string
	Category string
	Type     string
	Page     int
	PageSize int
}

func (q *Query) Normalize() {
	if q.Page < 1 {
		q.Page = 1
	}
	if q.PageSize < 1 {
		q.PageSize = 20
	}
	if q.PageSize > MaxPageSize {
		q.PageSize = MaxPageSize
	}
}

func (q *Query) Offset() int {
	return (q.Page - 1) * q.PageSize
}
