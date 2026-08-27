package port

import (
	"context"
	"github.com/yota/sprea/backend/internal/domain"
)

type OpportunityRepository interface {
	List(ctx context.Context) ([]domain.Opportunity, error)
	Find(ctx context.Context, id int64) (domain.Opportunity, error)
	SaveAll(ctx context.Context, items []domain.Opportunity) error
	ReplaceAll(ctx context.Context, items []domain.Opportunity) error
}

type Collector interface {
	Collect(ctx context.Context) ([]domain.Opportunity, error)
}

type MarketRepository interface {
	RecordSnapshots(context.Context, []domain.Opportunity) error
	History(context.Context, int64, int) ([]domain.PriceSnapshot, error)
	GetSettings(context.Context, string) (domain.UserSettings, error)
	SaveSettings(context.Context, domain.UserSettings) error
	ListAlerts(context.Context, string) ([]domain.AlertRule, error)
	CreateAlert(context.Context, domain.AlertRule) (domain.AlertRule, error)
	EvaluateNotifications(context.Context, []domain.Opportunity) (int, error)
	ListNotifications(context.Context, string, int) ([]domain.Notification, error)
	RecordCollectorRun(context.Context, domain.CollectorRun) error
	ListCollectorRuns(context.Context, int) ([]domain.CollectorRun, error)
}
