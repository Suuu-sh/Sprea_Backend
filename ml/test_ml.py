import numpy as np
import sqlite3
from pathlib import Path
from promote import promotable
from train import chronological_split, metrics, train

def test_label_boundary_metrics():
    m=metrics([True,False],[5000,-100],[.9,.8],.9)
    assert m["precision"]==1 and m["average_profit_yen"]==5000

def test_promotion_requires_all_gates_and_coverage():
    incumbent={"precision":.8,"average_profit_yen":6000,"max_loss_yen":-1000,"selected":10}
    assert promotable({"precision":.9,"average_profit_yen":7000,"max_loss_yen":-500,"selected":4},incumbent)
    assert not promotable({"precision":.95,"average_profit_yen":5000,"max_loss_yen":-500,"selected":4},incumbent)
    assert not promotable({"precision":1,"average_profit_yen":9000,"max_loss_yen":0,"selected":1},incumbent)

def test_train_rejects_empty_dataset(tmp_path: Path):
    db=tmp_path/"empty.db"
    with sqlite3.connect(db) as conn:
        conn.executescript("""CREATE TABLE research_opportunities(id INTEGER,detected_at TEXT,buy_cost_yen INTEGER,market_profit_yen INTEGER,resolver_confidence REAL);
        CREATE TABLE research_evaluations(opportunity_id INTEGER,horizon_hours INTEGER,profit_yen INTEGER);""")
    try:
        train(str(db),tmp_path/"out")
        assert False, "empty data must not train"
    except ValueError as error:
        assert "20 completed" in str(error)


def test_chronological_split_has_48h_embargo():
    import pandas as pd
    df=pd.DataFrame({"id":range(30),"detected_at":pd.date_range("2026-01-01",periods=30,freq="D").astype(str)})
    train_df,val_df,test_df=chronological_split(df)
    assert pd.Timestamp(val_df.detected_at.min())-pd.Timestamp(train_df.detected_at.max()) > pd.Timedelta(hours=48)
    assert pd.Timestamp(test_df.detected_at.min())-pd.Timestamp(val_df.detected_at.max()) > pd.Timedelta(hours=48)
