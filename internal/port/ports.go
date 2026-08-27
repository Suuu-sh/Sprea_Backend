package port

import (
	"context"
	"github.com/Suuu-sh/Sprea_Backend/internal/domain"
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
}
