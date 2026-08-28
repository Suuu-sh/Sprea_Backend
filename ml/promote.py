#!/usr/bin/env python3
"""Fail-closed promotion gate. Upload is performed by the workflow after this passes."""
from __future__ import annotations
import argparse, json
from pathlib import Path

def promotable(candidate, incumbent=None, min_precision=.80, min_selected=3):
    required=("precision","average_profit_yen","max_loss_yen","selected")
    if any(candidate.get(k) is None for k in required) or candidate["selected"]<min_selected: return False
    if incumbent is None: return candidate["precision"]>=min_precision and candidate["average_profit_yen"]>=5000 and candidate["max_loss_yen"]>=-5000
    return (candidate["precision"]>incumbent["precision"] and
      candidate["average_profit_yen"]>incumbent["average_profit_yen"] and
      candidate["max_loss_yen"]>=incumbent["max_loss_yen"])

if __name__=="__main__":
    p=argparse.ArgumentParser();p.add_argument("--candidate",required=True);p.add_argument("--incumbent")
    a=p.parse_args(); c=json.loads(Path(a.candidate).read_text()); i=None
    if a.incumbent and Path(a.incumbent).exists() and Path(a.incumbent).stat().st_size:
      try: i=json.loads(Path(a.incumbent).read_text())
      except json.JSONDecodeError: i=None
    result=promotable(c,i);print(json.dumps({"promote":result}));raise SystemExit(0 if result else 2)
