// Package matcher safely links purchase offers to buyback offers.
package matcher

import (
	"regexp"
	"strings"
	"unicode"
)

type Product struct {
	Name, JAN, Model, Capacity, Color, Generation string
}

type Result struct {
	Matched    bool    `json:"matched"`
	Confidence float64 `json:"confidence"`
	Reason     string  `json:"reason"`
}

var (
	nonAlphaNum = regexp.MustCompile(`[^a-z0-9]+`)
	spaces      = regexp.MustCompile(`\s+`)
)

// Match prioritizes an exact valid JAN. Conflicting variants are always rejected,
// even when names are similar, to avoid expensive false-positive opportunities.
func Match(a, b Product) Result {
	if conflicts(a.Capacity, b.Capacity) {
		return Result{Reason: "capacity mismatch"}
	}
	if conflicts(a.Color, b.Color) {
		return Result{Reason: "color mismatch"}
	}
	if conflicts(a.Generation, b.Generation) {
		return Result{Reason: "generation mismatch"}
	}

	janA, janB := digits(a.JAN), digits(b.JAN)
	if validJAN(janA) && validJAN(janB) {
		if janA == janB {
			return Result{Matched: true, Confidence: 1, Reason: "JAN match"}
		}
		return Result{Reason: "JAN mismatch"}
	}
	modelA, modelB := NormalizeModel(a.Model), NormalizeModel(b.Model)
	if modelA != "" && modelB != "" {
		if modelA != modelB {
			return Result{Reason: "model mismatch"}
		}
		return Result{Matched: true, Confidence: .94, Reason: "model match"}
	}
	score := tokenSimilarity(normalizeName(a.Name), normalizeName(b.Name))
	if score >= .8 {
		return Result{Matched: true, Confidence: .65 + score*.2, Reason: "name match"}
	}
	return Result{Confidence: score * .6, Reason: "insufficient identity evidence"}
}

// NormalizeModel makes punctuation, case, width and common model prefixes irrelevant.
func NormalizeModel(s string) string {
	s = strings.ToLower(strings.Map(widthFold, s))
	s = strings.TrimSpace(s)
	for _, prefix := range []string{"型番", "modelnumber", "modelno", "model"} {
		s = strings.TrimPrefix(strings.ReplaceAll(s, " ", ""), prefix)
	}
	return nonAlphaNum.ReplaceAllString(s, "")
}

func normalizeName(s string) string {
	s = strings.ToLower(strings.Map(widthFold, s))
	s = strings.NewReplacer("（", " ", "）", " ", "(", " ", ")", " ", "・", " ", "-", " ", "_", " ").Replace(s)
	return spaces.ReplaceAllString(strings.TrimSpace(s), " ")
}

func conflicts(a, b string) bool { return a != "" && b != "" && NormalizeModel(a) != NormalizeModel(b) }
func digits(s string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsDigit(r) {
			return r
		}
		return -1
	}, s)
}
func validJAN(s string) bool { return len(s) == 8 || len(s) == 13 }
func widthFold(r rune) rune {
	if r >= 'Ａ' && r <= 'Ｚ' {
		return r - 'Ａ' + 'A'
	}
	if r >= 'ａ' && r <= 'ｚ' {
		return r - 'ａ' + 'a'
	}
	if r >= '０' && r <= '９' {
		return r - '０' + '0'
	}
	return r
}

func tokenSimilarity(a, b string) float64 {
	aSet, bSet := map[string]bool{}, map[string]bool{}
	for _, x := range strings.Fields(a) {
		aSet[x] = true
	}
	for _, x := range strings.Fields(b) {
		bSet[x] = true
	}
	if len(aSet) == 0 || len(bSet) == 0 {
		return 0
	}
	intersection := 0
	for x := range aSet {
		if bSet[x] {
			intersection++
		}
	}
	return float64(2*intersection) / float64(len(aSet)+len(bSet))
}
