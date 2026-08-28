#!/usr/bin/env python3
"""Train a precision-first LightGBM candidate from a D1 SQLite export."""
from __future__ import annotations
import argparse, json, sqlite3
from pathlib import Path
import numpy as np
import pandas as pd

FEATURES = ["buy_cost_yen", "market_profit_yen", "resolver_confidence"]

def load_rows(db_path: str) -> pd.DataFrame:
    sql = """SELECT o.id,o.detected_at,o.buy_cost_yen,o.market_profit_yen,o.resolver_confidence,
      e.profit_yen realized_profit_yen,(e.profit_yen>=5000) label
      FROM research_opportunities o JOIN research_evaluations e ON e.opportunity_id=o.id AND e.horizon_hours=48
      WHERE e.profit_yen IS NOT NULL ORDER BY o.detected_at,o.id"""
    with sqlite3.connect(db_path) as conn: return pd.read_sql_query(sql, conn)

def chronological_split(df: pd.DataFrame, embargo_hours: int = 48):
    """Time split with a label-horizon embargo before validation and test."""
    ordered=df.sort_values(["detected_at", "id"]).reset_index(drop=True).copy()
    ordered["_detected"]=pd.to_datetime(ordered.detected_at, utc=True)
    n=len(ordered); a=max(1,int(n*.6)); b=max(a+1,int(n*.8))
    val_start=ordered.iloc[a]["_detected"]
    test_start=ordered.iloc[b]["_detected"]
    gap=pd.Timedelta(hours=embargo_hours)
    train_df=ordered[ordered._detected < val_start-gap]
    val_df=ordered[(ordered._detected >= val_start) & (ordered._detected < test_start-gap)]
    test_df=ordered[ordered._detected >= test_start]
    return tuple(x.drop(columns=["_detected"]) for x in (train_df,val_df,test_df))

def metrics(y, profit, probability, threshold):
    selected=np.asarray(probability)>=threshold; y=np.asarray(y).astype(bool); profit=np.asarray(profit)
    tp=int((selected&y).sum()); fp=int((selected&~y).sum()); fn=int((~selected&y).sum())
    return {"precision":tp/(tp+fp) if tp+fp else 0.0,"recall":tp/(tp+fn) if tp+fn else 0.0,
      "selected":int(selected.sum()),"coverage":float(selected.mean()),
      "average_profit_yen":float(profit[selected].mean()) if selected.any() else None,
      "max_loss_yen":float(profit[selected].min()) if selected.any() else None}

def choose_threshold(y, profit, probability, min_selected=3):
    candidates=[]
    for threshold in np.arange(.50,.96,.01):
      m=metrics(y,profit,probability,float(threshold))
      if m["selected"]>=min_selected: candidates.append((m["precision"],m["average_profit_yen"],m["recall"],float(threshold)))
    if not candidates: raise ValueError("insufficient validation selections")
    return max(candidates)[3]

def train(db_path: str, out: Path):
    df=load_rows(db_path)
    if len(df)<20 or df.label.nunique()<2: raise ValueError("at least 20 completed 48h rows with both labels are required")
    import lightgbm as lgb
    train_df,val_df,test_df=chronological_split(df)
    if min(len(val_df),len(test_df))<2 or train_df.label.nunique()<2: raise ValueError("insufficient chronological split")
    model=lgb.LGBMClassifier(n_estimators=100,num_leaves=15,learning_rate=.05,random_state=42,verbosity=-1)
    model.fit(train_df[FEATURES],train_df.label)
    threshold=choose_threshold(val_df.label,val_df.realized_profit_yen,model.predict_proba(val_df[FEATURES])[:,1])
    report=metrics(test_df.label,test_df.realized_profit_yen,model.predict_proba(test_df[FEATURES])[:,1],threshold)
    report.update({"threshold":threshold,"samples":len(df),"test_samples":len(test_df),"features":FEATURES,"label":"48h_market_profit_yen >= 5000","embargo_hours":48})
    out.mkdir(parents=True,exist_ok=True); model.booster_.save_model(str(out/"model.txt"))
    (out/"metrics.json").write_text(json.dumps(report,indent=2,sort_keys=True)+"\n")
    (out/"manifest.json").write_text(json.dumps({"format":"lightgbm-text","runtime":"training-artifact-only","threshold":threshold,"features":FEATURES},indent=2)+"\n")
    return report

if __name__=="__main__":
    p=argparse.ArgumentParser();p.add_argument("--db",required=True);p.add_argument("--out",default="artifacts/candidate")
    a=p.parse_args(); out=Path(a.out)
    try:
        print(json.dumps(train(a.db,out)))
    except ValueError as error:
        # A fresh production database has no mature 48h labels yet. This is an
        # expected no-op, not an infrastructure failure; promotion still fails
        # closed because the report does not contain qualifying metrics.
        out.mkdir(parents=True,exist_ok=True)
        report={"status":"insufficient_data","reason":str(error),"promotable":False}
        (out/"metrics.json").write_text(json.dumps(report,indent=2,sort_keys=True)+"\n")
        print(json.dumps(report))
