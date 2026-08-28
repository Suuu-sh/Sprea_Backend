package research

import (
	"context"
	"fmt"
	"time"
)

type RunResult struct {
	Accepted      int                `json:"accepted"`
	Rejected      int                `json:"rejected"`
	Opportunities []Opportunity      `json:"opportunities"`
	Decisions     []ResearchDecision `json:"decisions"`
	Opened        []PaperTrade       `json:"openedTrades"`
	Evaluations   []Evaluation       `json:"evaluations"`
	Portfolio     Portfolio          `json:"portfolio"`
	Metrics       StrategyMetrics    `json:"ruleMetrics48h"`
}

type Pipeline struct {
	Store             *Store
	InitialCapital    int
	MinimumProfit     int
	MinimumConfidence float64
	SaleShipping      int
	Fees              int
}

func (p Pipeline) Run(ctx context.Context, observations []Observation, now time.Time) (RunResult, error) {
	if p.Store == nil {
		return RunResult{}, fmt.Errorf("store is required")
	}
	if p.InitialCapital <= 0 {
		p.InitialCapital = 300000
	}
	if p.MinimumProfit <= 0 {
		p.MinimumProfit = 5000
	}
	if p.MinimumConfidence <= 0 {
		p.MinimumConfidence = .95
	}
	resolved := make([]ResolvedObservation, 0, len(observations))
	rejected := 0
	for _, o := range observations {
		x, e := Resolve(o)
		if e != nil {
			rejected++
			continue
		}
		resolved = append(resolved, x)
	}
	if err := p.Store.SaveObservations(ctx, resolved); err != nil {
		return RunResult{}, err
	}
	opportunities := Detect(resolved, now, EngineConfig{SaleShipping: p.SaleShipping, Fees: p.Fees})
	if err := p.Store.SaveOpportunities(ctx, opportunities); err != nil {
		return RunResult{}, err
	}
	decisions, err := p.Store.SaveDecisions(ctx, opportunities, p.MinimumProfit, p.MinimumConfidence)
	if err != nil {
		return RunResult{}, err
	}
	opened, err := p.Store.OpenTrades(ctx, opportunities, p.InitialCapital, p.MinimumProfit, p.MinimumConfidence)
	if err != nil {
		return RunResult{}, err
	}
	evaluations, err := p.Store.EvaluateDue(ctx, now, p.SaleShipping, p.Fees, p.MinimumProfit)
	if err != nil {
		return RunResult{}, err
	}
	decisionEvaluations, err := p.Store.EvaluateDecisions(ctx, now, p.MinimumProfit)
	if err != nil {
		return RunResult{}, err
	}
	evaluations = append(evaluations, decisionEvaluations...)
	portfolio, err := p.Store.Portfolio(ctx, p.InitialCapital)
	if err != nil {
		return RunResult{}, err
	}
	metrics, err := p.Store.StrategyMetrics(ctx, "rule-v1", 48)
	if err != nil {
		return RunResult{}, err
	}
	return RunResult{Accepted: len(resolved), Rejected: rejected, Opportunities: opportunities, Decisions: decisions, Opened: opened, Evaluations: evaluations, Portfolio: portfolio, Metrics: metrics}, nil
}
