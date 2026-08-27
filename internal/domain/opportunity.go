package domain

type Opportunity struct {
	ID            int64   `json:"id"`
	Name          string  `json:"name"`
	Category      string  `json:"category"`
	Source        string  `json:"source"`
	Buyer         string  `json:"buyer"`
	ImageURL      string  `json:"imageUrl"`
	PurchasePrice int     `json:"purchasePrice"`
	BuybackPrice  int     `json:"buybackPrice"`
	BasePointRate int     `json:"basePointRate"`
	AdjustedRate  int     `json:"adjustedPointRate"`
	PointValue    int     `json:"pointValue"`
	EffectiveCost int     `json:"effectiveCost"`
	Profit        int     `json:"profit"`
	ProfitRate    float64 `json:"profitRate"`
	UpdatedAt     string  `json:"updatedAt"`
}

type PriceSnapshot struct {
	ID            int64  `json:"id"`
	OpportunityID int64  `json:"opportunityId"`
	PurchasePrice int    `json:"purchasePrice"`
	BuybackPrice  int    `json:"buybackPrice"`
	CapturedAt    string `json:"capturedAt"`
}
type UserSettings struct {
	UserID            string  `json:"userId"`
	PointAdjustment   int     `json:"pointAdjustment"`
	MinimumProfit     int     `json:"minimumProfit"`
	MinimumProfitRate float64 `json:"minimumProfitRate"`
}
type AlertRule struct {
	ID                int64   `json:"id"`
	UserID            string  `json:"userId"`
	Name              string  `json:"name"`
	MinimumProfit     int     `json:"minimumProfit"`
	MinimumProfitRate float64 `json:"minimumProfitRate"`
	Enabled           bool    `json:"enabled"`
}

func (o Opportunity) WithPointAdjustment(adjustment int) Opportunity {
	o.AdjustedRate = max(0, o.BasePointRate+adjustment)
	o.PointValue = o.PurchasePrice * o.AdjustedRate / 100
	o.EffectiveCost = o.PurchasePrice - o.PointValue
	o.Profit = o.BuybackPrice - o.EffectiveCost
	if o.EffectiveCost > 0 {
		o.ProfitRate = float64(o.Profit) / float64(o.EffectiveCost) * 100
	}
	return o
}
