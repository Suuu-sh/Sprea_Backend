package research

import "time"

type Side string

const (
	Purchase Side = "purchase"
	Buyback  Side = "buyback"
)

// Observation is the lossless boundary between a source-specific collector and
// the research pipeline. Raw is retained so parser bugs can be repaired later.
type Observation struct {
	Source          string         `json:"source"`
	Side            Side           `json:"side"`
	SourceProductID string         `json:"sourceProductId"`
	Title           string         `json:"title"`
	Price           int            `json:"price"`
	Shipping        int            `json:"shipping"`
	Stock           bool           `json:"stock"`
	Condition       string         `json:"condition"`
	JAN             string         `json:"jan,omitempty"`
	Model           string         `json:"model,omitempty"`
	Capacity        string         `json:"capacity,omitempty"`
	Color           string         `json:"color,omitempty"`
	CapturedAt      time.Time      `json:"capturedAt"`
	Raw             map[string]any `json:"raw,omitempty"`
}

type ResolvedObservation struct {
	Observation
	CanonicalKey string  `json:"canonicalKey"`
	Confidence   float64 `json:"confidence"`
	MatchReason  string  `json:"matchReason"`
}

type Opportunity struct {
	CanonicalKey       string    `json:"canonicalKey"`
	Title              string    `json:"title"`
	PurchaseSource     string    `json:"purchaseSource"`
	BuybackSource      string    `json:"buybackSource"`
	PurchasePrice      int       `json:"purchasePrice"`
	PurchaseShipping   int       `json:"purchaseShipping"`
	BuybackPrice       int       `json:"buybackPrice"`
	SaleShipping       int       `json:"saleShipping"`
	Fees               int       `json:"fees"`
	CertainRewards     int       `json:"certainRewards"`
	MarketProfit       int       `json:"marketProfit"`
	ProfitRate         float64   `json:"profitRate"`
	ResolverConfidence float64   `json:"resolverConfidence"`
	DetectedAt         time.Time `json:"detectedAt"`
}

type PaperTrade struct {
	ID                int64      `json:"id"`
	CanonicalKey      string     `json:"canonicalKey"`
	Title             string     `json:"title"`
	PurchaseSource    string     `json:"purchaseSource"`
	BuybackSource     string     `json:"buybackSource"`
	PurchasePrice     int        `json:"purchasePrice"`
	LockedCapital     int        `json:"lockedCapital"`
	EntryBuybackPrice int        `json:"entryBuybackPrice"`
	EntryProfit       int        `json:"entryProfit"`
	OpenedAt          time.Time  `json:"openedAt"`
	ClosedAt          *time.Time `json:"closedAt,omitempty"`
	Status            string     `json:"status"`
}

type Evaluation struct {
	TradeID      int64     `json:"tradeId"`
	HorizonHours int       `json:"horizonHours"`
	BuybackPrice int       `json:"buybackPrice"`
	Profit       int       `json:"profit"`
	TargetMet    bool      `json:"targetMet"`
	EvaluatedAt  time.Time `json:"evaluatedAt"`
}

type Portfolio struct {
	InitialCapital int `json:"initialCapital"`
	LockedCapital  int `json:"lockedCapital"`
	AvailableCash  int `json:"availableCash"`
	OpenTrades     int `json:"openTrades"`
}
