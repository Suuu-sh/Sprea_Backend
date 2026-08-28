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
	BuybackStoreCount  int       `json:"buybackStoreCount"`
	SecondBuybackPrice int       `json:"secondBuybackPrice"`
	TopTwoSpreadRate   float64   `json:"topTwoSpreadRate"`
	CapitalDays        int       `json:"capitalDays"`
	AnnualizedReturn   float64   `json:"annualizedReturn"`
	Return30Days       float64   `json:"return30Days"`
	SpreaScore         int       `json:"spreaScore"`
	DetectedAt         time.Time `json:"detectedAt"`
}

type Decision string

const (
	DecisionBuy  Decision = "buy"
	DecisionSkip Decision = "skip"
)

type ResearchDecision struct {
	ID               int64     `json:"id"`
	CanonicalKey     string    `json:"canonicalKey"`
	Title            string    `json:"title"`
	Decision         Decision  `json:"decision"`
	Reason           string    `json:"reason"`
	Strategy         string    `json:"strategy"`
	PurchasePrice    int       `json:"purchasePrice"`
	PurchaseShipping int       `json:"purchaseShipping"`
	SaleShipping     int       `json:"saleShipping"`
	Fees             int       `json:"fees"`
	EntryProfit      int       `json:"entryProfit"`
	SpreaScore       int       `json:"spreaScore"`
	DecidedAt        time.Time `json:"decidedAt"`
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
	DecisionID   int64     `json:"decisionId,omitempty"`
	HorizonHours int       `json:"horizonHours"`
	BuybackPrice int       `json:"buybackPrice"`
	Profit       int       `json:"profit"`
	TargetMet    bool      `json:"targetMet"`
	Outcome      string    `json:"outcome,omitempty"`
	EvaluatedAt  time.Time `json:"evaluatedAt"`
}

type RealityCalibration struct {
	ID                  int64     `json:"id"`
	CanonicalKey        string    `json:"canonicalKey"`
	PurchaseSource      string    `json:"purchaseSource"`
	BuybackSource       string    `json:"buybackSource"`
	PredictedProfit     int       `json:"predictedProfit"`
	ActualPurchasePrice int       `json:"actualPurchasePrice"`
	ActualPayout        int       `json:"actualPayout"`
	ActualCosts         int       `json:"actualCosts"`
	ActualProfit        int       `json:"actualProfit"`
	Slippage            int       `json:"slippage"`
	DeliveryDays        float64   `json:"deliveryDays"`
	ReductionReason     string    `json:"reductionReason"`
	RecordedAt          time.Time `json:"recordedAt"`
}

type StrategyMetrics struct {
	Strategy            string  `json:"strategy"`
	HorizonHours        int     `json:"horizonHours"`
	Evaluated           int     `json:"evaluated"`
	BuyCount            int     `json:"buyCount"`
	Precision           float64 `json:"precision"`
	Recall              float64 `json:"recall"`
	MissedOpportunities int     `json:"missedOpportunities"`
	AverageProfit       float64 `json:"averageProfit"`
	MaximumLoss         int     `json:"maximumLoss"`
}

type ModelExperiment struct {
	ID               int64     `json:"id"`
	Name             string    `json:"name"`
	CandidateVersion string    `json:"candidateVersion"`
	BaselineVersion  string    `json:"baselineVersion"`
	DatasetCutoff    time.Time `json:"datasetCutoff"`
	Precision        float64   `json:"precision"`
	Recall           float64   `json:"recall"`
	AverageProfit    float64   `json:"averageProfit"`
	MaximumLoss      int       `json:"maximumLoss"`
	Promoted         bool      `json:"promoted"`
	CreatedAt        time.Time `json:"createdAt"`
}

type SourcePolicy struct {
	Source     string    `json:"source"`
	Method     string    `json:"method"`
	TermsURL   string    `json:"termsUrl"`
	RobotsURL  string    `json:"robotsUrl"`
	Status     string    `json:"status"`
	ReviewedAt time.Time `json:"reviewedAt"`
	Notes      string    `json:"notes"`
}

type Portfolio struct {
	InitialCapital int `json:"initialCapital"`
	LockedCapital  int `json:"lockedCapital"`
	AvailableCash  int `json:"availableCash"`
	OpenTrades     int `json:"openTrades"`
}

type Dashboard struct {
	Portfolio     Portfolio          `json:"portfolio"`
	Opportunities []Opportunity      `json:"opportunities"`
	Decisions     []ResearchDecision `json:"decisions"`
	Metrics48h    StrategyMetrics    `json:"metrics48h"`
}
