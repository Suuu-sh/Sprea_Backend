package service

import (
	"context"
	"github.com/Suuu-sh/Sprea_Backend/internal/domain"
	"github.com/Suuu-sh/Sprea_Backend/internal/port"
)

type Opportunities struct{ repo port.OpportunityRepository }

func New(repo port.OpportunityRepository) *Opportunities { return &Opportunities{repo: repo} }

func (s *Opportunities) List(ctx context.Context, adjustment int) ([]domain.Opportunity, error) {
	items, err := s.repo.List(ctx)
	if err != nil {
		return nil, err
	}
	for i := range items {
		items[i] = items[i].WithPointAdjustment(adjustment)
	}
	return items, nil
}
func (s *Opportunities) Find(ctx context.Context, id int64, adjustment int) (domain.Opportunity, error) {
	o, err := s.repo.Find(ctx, id)
	if err != nil {
		return o, err
	}
	return o.WithPointAdjustment(adjustment), nil
}
